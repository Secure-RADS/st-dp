package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/mdlayher/vsock"
)

// The host runs one vsock-proxy per outside host, each on a fixed port (see userdata.sh.tmpl).
const (
	verifierProxyPort = 8001
	pdmProxyPort      = 8002
)

const (
	vsockDialTimeout    = 10 * time.Second
	tlsHandshakeTimeout = 10 * time.Second
)

func pinnedVsockHTTPClient(host, pinSHA256 string, proxyPort uint32) *http.Client {
	return &http.Client{
		Timeout: attestRequestTimeout,
		Transport: &http.Transport{
			DialTLSContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				raw, err := dialVsock(ctx, hostCID, proxyPort)
				if err != nil {
					return nil, err
				}
				if err := raw.SetDeadline(time.Now().Add(tlsHandshakeTimeout)); err != nil {
					raw.Close()
					return nil, err
				}
				tlsConn := tls.Client(raw, &tls.Config{
					ServerName:            host,
					InsecureSkipVerify:    true, // chain verification replaced by pinning below
					VerifyPeerCertificate: pinnedCertVerifier(pinSHA256),
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

// net.FileConn doesn't recognize AF_VSOCK (returns "protocol not supported"), so this needs a real vsock-aware
// net.Conn rather than the raw-fd wrapping used elsewhere in this file.
func dialVsock(ctx context.Context, cid, port uint32) (net.Conn, error) {
	type result struct {
		conn net.Conn
		err  error
	}
	resultCh := make(chan result, 1)
	go func() {
		conn, err := vsock.Dial(cid, port, nil)
		resultCh <- result{conn, err}
	}()

	select {
	case res := <-resultCh:
		return res.conn, res.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(vsockDialTimeout):
		return nil, fmt.Errorf("timed out after %s dialing vsock CID %d port %d", vsockDialTimeout, cid, port)
	}
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
