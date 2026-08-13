package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/cyclicalvc/nitro-enclaves-sdk/nsm"
	nsmrequest "github.com/cyclicalvc/nitro-enclaves-sdk/nsm/request"
	"github.com/mdlayher/vsock"
)

// Trust material baked in at build time (registry-service/rootfs.go), not
// configurable at runtime - matches this repo's established convention.
const (
	sceTLSCertPath        = "/etc/sce/tls/client.crt"
	sceTLSKeyPath         = "/etc/sce/tls/client.key"
	verifierAttestURLPath = "/etc/sce/verifier-attest-url"
	verifierPubkeyPath    = "/etc/sce/verifier-pubkey.sha256"
	algorithmIdPath       = "/etc/sce/algorithm-id"

	// AWS-defined constant: CID 3 always addresses the parent instance from
	// inside an enclave. Port must match execution-service's vsock-proxy
	// invocation (sce/execution-service/ec2.go).
	parentCID         = 3
	verifierVsockPort = 8000

	// Refresh well before expiry so a slow refresh call never races an
	// access token going stale mid-request.
	tokenRefreshMargin = 30 * time.Second
)

type tokenPair struct {
	AccessToken          string `json:"accessToken"`
	RefreshToken         string `json:"refreshToken"`
	AccessTokenExpiresAt string `json:"accessTokenExpiresAt"`
}

type tokenHolder struct {
	mu   sync.RWMutex
	pair tokenPair
}

func (h *tokenHolder) get() tokenPair {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.pair
}

func (h *tokenHolder) set(p tokenPair) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pair = p
}

var tokens tokenHolder

// startAttestation fetches a real Nitro attestation document from NSM,
// submits it to verifier-service over mTLS (through the parent instance's
// vsock-proxy tunnel - the enclave has no direct network access at all),
// and holds the returned access/refresh token pair, refreshing proactively
// before expiry so the rest of sce-unit never has to re-attest mid-run.
func startAttestation(ctx context.Context) error {
	client, err := newVerifierClient()
	if err != nil {
		return fmt.Errorf("build verifier mTLS client: %w", err)
	}

	algorithmId, err := readTrimmed(algorithmIdPath)
	if err != nil {
		return fmt.Errorf("read algorithm id: %w", err)
	}
	attestURL, err := readTrimmed(verifierAttestURLPath)
	if err != nil {
		return fmt.Errorf("read verifier attest url: %w", err)
	}

	docB64, err := fetchAttestationDocumentB64()
	if err != nil {
		return fmt.Errorf("fetch attestation document: %w", err)
	}

	pair, err := attest(ctx, client, attestURL, algorithmId, docB64)
	if err != nil {
		return fmt.Errorf("attest to verifier-service: %w", err)
	}
	tokens.set(pair)
	log.Printf("sce-unit: attested successfully, access token expires at %s", pair.AccessTokenExpiresAt)

	go refreshLoop(ctx, client)
	return nil
}

// fetchAttestationDocumentB64 calls the NSM device directly (/dev/nsm) for
// a fresh attestation document. sce-unit runs inside the enclave itself, so
// unlike a relay pattern this is a direct in-process NSM call, not a vsock
// hop to a separate attestation service.
func fetchAttestationDocumentB64() (string, error) {
	session, err := nsm.OpenDefaultSession()
	if err != nil {
		return "", fmt.Errorf("open NSM session: %w", err)
	}
	defer session.Close()

	resp, err := session.Send(&nsmrequest.Attestation{})
	if err != nil {
		return "", fmt.Errorf("request NSM attestation document: %w", err)
	}
	if resp.Error != "" {
		return "", fmt.Errorf("NSM error: %s", resp.Error)
	}
	if resp.Attestation == nil || len(resp.Attestation.Document) == 0 {
		return "", fmt.Errorf("NSM response did not include an attestation document")
	}
	return base64.StdEncoding.EncodeToString(resp.Attestation.Document), nil
}

func attest(ctx context.Context, client *http.Client, attestURL, algorithmId, docB64 string) (tokenPair, error) {
	body, err := json.Marshal(struct {
		AlgorithmId         string `json:"algorithmId"`
		AttestationDocument string `json:"attestationDocument"`
	}{AlgorithmId: algorithmId, AttestationDocument: docB64})
	if err != nil {
		return tokenPair{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, attestURL, bytes.NewReader(body))
	if err != nil {
		return tokenPair{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return tokenPair{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return tokenPair{}, fmt.Errorf("verifier-service returned %s", resp.Status)
	}

	var pair tokenPair
	if err := json.NewDecoder(resp.Body).Decode(&pair); err != nil {
		return tokenPair{}, fmt.Errorf("decode token response: %w", err)
	}
	return pair, nil
}

// refreshLoop proactively exchanges the refresh token for a new access
// token before the current one expires - this is the whole point of the
// refresh token existing: sce-unit never has to fetch a fresh attestation
// document and redo the full verification round trip for every call.
func refreshLoop(ctx context.Context, client *http.Client) {
	refreshURL := strings.TrimSuffix(mustRead(verifierAttestURLPath), "/attest") + "/refresh"

	for {
		current := tokens.get()
		expiresAt, err := time.Parse(time.RFC3339, current.AccessTokenExpiresAt)
		if err != nil {
			log.Printf("sce-unit: could not parse token expiry, retrying refresh in %s: %v", tokenRefreshMargin, err)
			time.Sleep(tokenRefreshMargin)
			continue
		}

		sleepFor := time.Until(expiresAt) - tokenRefreshMargin
		if sleepFor > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(sleepFor):
			}
		}

		newPair, err := refreshAccessToken(ctx, client, refreshURL, current.RefreshToken)
		if err != nil {
			log.Printf("sce-unit: token refresh failed, retrying in %s: %v", tokenRefreshMargin, err)
			time.Sleep(tokenRefreshMargin)
			continue
		}
		tokens.set(newPair)
		log.Printf("sce-unit: refreshed access token, expires at %s", newPair.AccessTokenExpiresAt)
	}
}

func refreshAccessToken(ctx context.Context, client *http.Client, refreshURL, refreshToken string) (tokenPair, error) {
	body, err := json.Marshal(struct {
		RefreshToken string `json:"refreshToken"`
	}{RefreshToken: refreshToken})
	if err != nil {
		return tokenPair{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, refreshURL, bytes.NewReader(body))
	if err != nil {
		return tokenPair{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return tokenPair{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return tokenPair{}, fmt.Errorf("verifier-service returned %s", resp.Status)
	}

	var pair tokenPair
	if err := json.NewDecoder(resp.Body).Decode(&pair); err != nil {
		return tokenPair{}, fmt.Errorf("decode token response: %w", err)
	}
	// The refresh token itself doesn't rotate - carry the current one forward.
	pair.RefreshToken = refreshToken
	return pair, nil
}

// newVerifierClient builds an mTLS client identical in spirit to
// registry-service's own (verifier.go): baked-in client cert, pinned
// server pubkey instead of full chain trust. The only enclave-specific
// difference is the transport dials out over vsock to the parent
// instance's vsock-proxy tunnel rather than a normal TCP connection,
// since the enclave has no direct network access.
func newVerifierClient() (*http.Client, error) {
	cert, err := tls.LoadX509KeyPair(sceTLSCertPath, sceTLSKeyPath)
	if err != nil {
		return nil, fmt.Errorf("load client cert: %w", err)
	}

	pinnedPubKeySHA256, err := readTrimmed(verifierPubkeyPath)
	if err != nil {
		return nil, fmt.Errorf("read pinned verifier pubkey: %w", err)
	}

	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return vsock.Dial(parentCID, verifierVsockPort, nil)
			},
			TLSClientConfig: &tls.Config{
				Certificates:          []tls.Certificate{cert},
				InsecureSkipVerify:    true, // chain verification replaced by pinning below
				VerifyPeerCertificate: pinnedCertVerifier(pinnedPubKeySHA256),
			},
		},
	}, nil
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

func readTrimmed(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(raw)), nil
}

func mustRead(path string) string {
	s, err := readTrimmed(path)
	if err != nil {
		log.Fatalf("sce-unit: read %s: %v", path, err)
	}
	return s
}
