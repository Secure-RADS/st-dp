package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/hf/nsm"
	"github.com/hf/nsm/request"
	"golang.org/x/sys/unix"
)

// The host pushes runConfig here once, right after nitro-cli run-enclave starts us (see userdata.sh.tmpl).
const configPort = 5001

const (
	receiveConfigTimeout = 30 * time.Second
	vsockDialTimeout     = 10 * time.Second
	tlsHandshakeTimeout  = 10 * time.Second
	attestRequestTimeout = 30 * time.Second
)

// runConfig is the one-shot JSON message the host pushes over vsock at boot - the enclave has no other way to
// learn which algorithm it's running or how to reach verifier-service, since Nitro Enclaves take no user-data.
type runConfig struct {
	AlgorithmId          string `json:"algorithmId"`
	VerifierHost         string `json:"verifierHost"`
	VerifierProxyPort    int    `json:"verifierProxyPort"`
	VerifierPubKeySHA256 string `json:"verifierPubKeySHA256"`
}

func receiveRunConfig() (runConfig, error) {
	fd, err := unix.Socket(unix.AF_VSOCK, unix.SOCK_STREAM, 0)
	if err != nil {
		return runConfig{}, err
	}
	defer unix.Close(fd)

	if err := unix.Bind(fd, &unix.SockaddrVM{CID: unix.VMADDR_CID_ANY, Port: configPort}); err != nil {
		return runConfig{}, err
	}
	if err := unix.Listen(fd, 1); err != nil {
		return runConfig{}, err
	}

	type acceptResult struct {
		fd  int
		err error
	}
	acceptCh := make(chan acceptResult, 1)
	go func() {
		connFd, _, err := unix.Accept(fd)
		acceptCh <- acceptResult{connFd, err}
	}()

	var connFd int
	select {
	case res := <-acceptCh:
		if res.err != nil {
			return runConfig{}, res.err
		}
		connFd = res.fd
	case <-time.After(receiveConfigTimeout):
		return runConfig{}, fmt.Errorf("timed out after %s waiting for the host to push run config", receiveConfigTimeout)
	}
	defer unix.Close(connFd)

	deadline := unix.NsecToTimeval(receiveConfigTimeout.Nanoseconds())
	if err := unix.SetsockoptTimeval(connFd, unix.SOL_SOCKET, unix.SO_RCVTIMEO, &deadline); err != nil {
		return runConfig{}, fmt.Errorf("set read timeout: %w", err)
	}

	var buf bytes.Buffer
	chunk := make([]byte, 4096)
	for {
		n, err := unix.Read(connFd, chunk)
		if n > 0 {
			buf.Write(chunk[:n])
		}
		if err != nil || n == 0 {
			break
		}
	}

	var cfg runConfig
	if err := json.Unmarshal(buf.Bytes(), &cfg); err != nil {
		return runConfig{}, fmt.Errorf("parse run config: %w", err)
	}
	return cfg, nil
}

func attest(cfg runConfig) (accessToken, refreshToken string, err error) {
	priv, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("generate ephemeral key: %w", err)
	}
	pubKey := elliptic.Marshal(elliptic.P384(), priv.PublicKey.X, priv.PublicKey.Y)

	nonce := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", "", fmt.Errorf("generate nonce: %w", err)
	}

	sess, err := nsm.OpenDefaultSession()
	if err != nil {
		return "", "", fmt.Errorf("open NSM session: %w", err)
	}
	defer sess.Close()

	res, err := sess.Send(&request.Attestation{Nonce: nonce, PublicKey: pubKey})
	if err != nil {
		return "", "", fmt.Errorf("request attestation document: %w", err)
	}
	if res.Error != "" {
		return "", "", fmt.Errorf("NSM: %s", res.Error)
	}
	if res.Attestation == nil || res.Attestation.Document == nil {
		return "", "", fmt.Errorf("NSM returned no attestation document")
	}

	body, err := json.Marshal(struct {
		AlgorithmId         string `json:"algorithmId"`
		AttestationDocument string `json:"attestationDocument"`
	}{
		AlgorithmId:         cfg.AlgorithmId,
		AttestationDocument: base64.StdEncoding.EncodeToString(res.Attestation.Document),
	})
	if err != nil {
		return "", "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), attestRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+cfg.VerifierHost+"/attest", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")

	client := verifierHTTPClient(cfg)
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("POST /attest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("verifier-service returned %s: %s", resp.Status, respBody)
	}

	var tokens struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil {
		return "", "", fmt.Errorf("decode token response: %w", err)
	}
	return tokens.AccessToken, tokens.RefreshToken, nil
}

func verifierHTTPClient(cfg runConfig) *http.Client {
	return &http.Client{
		Timeout: attestRequestTimeout,
		Transport: &http.Transport{
			DialTLSContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				raw, err := dialVsock(ctx, hostCID, uint32(cfg.VerifierProxyPort))
				if err != nil {
					return nil, err
				}
				if err := raw.SetDeadline(time.Now().Add(tlsHandshakeTimeout)); err != nil {
					raw.Close()
					return nil, err
				}
				tlsConn := tls.Client(raw, &tls.Config{
					ServerName:            cfg.VerifierHost,
					InsecureSkipVerify:    true, // chain verification replaced by pinning below
					VerifyPeerCertificate: pinnedCertVerifier(cfg.VerifierPubKeySHA256),
				})
				if err := tlsConn.Handshake(); err != nil {
					raw.Close()
					return nil, err
				}
				if err := raw.SetDeadline(time.Time{}); err != nil {
					tlsConn.Close()
					return nil, err
				}
				return tlsConn, nil
			},
		},
	}
}

func dialVsock(ctx context.Context, cid, port uint32) (net.Conn, error) {
	fd, err := unix.Socket(unix.AF_VSOCK, unix.SOCK_STREAM, 0)
	if err != nil {
		return nil, err
	}

	connectErr := make(chan error, 1)
	go func() { connectErr <- unix.Connect(fd, &unix.SockaddrVM{CID: cid, Port: port}) }()

	select {
	case err := <-connectErr:
		if err != nil {
			unix.Close(fd)
			return nil, err
		}
	case <-ctx.Done():
		unix.Close(fd)
		return nil, ctx.Err()
	case <-time.After(vsockDialTimeout):
		unix.Close(fd)
		return nil, fmt.Errorf("timed out after %s dialing vsock CID %d port %d", vsockDialTimeout, cid, port)
	}

	f := os.NewFile(uintptr(fd), "vsock")
	conn, err := net.FileConn(f)
	f.Close()
	return conn, err
}

func pinnedCertVerifier(wantSHA256Hex string) func([][]byte, [][]*x509.Certificate) error {
	return func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return fmt.Errorf("no peer certificate presented")
		}
		leaf, err := x509.ParseCertificate(rawCerts[0])
		if err != nil {
			return fmt.Errorf("parse peer certificate: %w", err)
		}
		sum := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
		got := fmt.Sprintf("%x", sum)
		if got != wantSHA256Hex {
			return fmt.Errorf("peer pubkey pin mismatch: got %s want %s", got, wantSHA256Hex)
		}
		return nil
	}
}

func logAttestOutcome(cfg runConfig) {
	accessToken, _, err := attest(cfg)
	if err != nil {
		log.Printf("sce-unit: attestation failed: %v", err)
		return
	}
	log.Printf("sce-unit: attested successfully, got access token (len %d)", len(accessToken))
}
