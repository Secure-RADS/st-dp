package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"

	"github.com/mdlayher/vsock"
)

// Second, distinct mTLS identity from the one used for verifier-service -
// PDMS is a different destination with its own trust material, baked in
// separately (registry-service/rootfs.go's writeScePDMSTrustMaterial).
const (
	scePDMSTLSCertPath = "/etc/sce/pdms-tls/client.crt"
	scePDMSTLSKeyPath  = "/etc/sce/pdms-tls/client.key"
	pdmsURLPath        = "/etc/sce/pdms-url"
	pdmsPubkeyPath     = "/etc/sce/pdms-pubkey.sha256"

	pdmsVsockPort = 8001
)

// callPDMS proves the full loop this PR set out to close: the enclave
// attests, gets a token, and successfully uses it to reach PDMS - PDMS
// itself only returns a stub response (no real personal-data plane yet).
// One-shot, not retried - callers that need retry/backoff belong in the
// real PDMS-data-fetching logic this stub is standing in for.
func callPDMS(ctx context.Context) error {
	pdmsURL, err := readTrimmed(pdmsURLPath)
	if err != nil || pdmsURL == "" {
		return fmt.Errorf("PDMS not configured, skipping: %w", err)
	}

	client, err := newPDMSClient()
	if err != nil {
		return fmt.Errorf("build PDMS mTLS client: %w", err)
	}

	accessToken := tokens.get().AccessToken
	if accessToken == "" {
		return fmt.Errorf("no access token held yet")
	}

	body, err := json.Marshal(struct {
		AccessToken string `json:"accessToken"`
	}{AccessToken: accessToken})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pdmsURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("PDMS returned %s", resp.Status)
	}
	log.Printf("sce-unit: PDMS call succeeded (status %s)", resp.Status)
	return nil
}

func newPDMSClient() (*http.Client, error) {
	cert, err := tls.LoadX509KeyPair(scePDMSTLSCertPath, scePDMSTLSKeyPath)
	if err != nil {
		return nil, fmt.Errorf("load client cert: %w", err)
	}

	pinnedPubKeySHA256, err := readTrimmed(pdmsPubkeyPath)
	if err != nil {
		return nil, fmt.Errorf("read pinned pdms pubkey: %w", err)
	}
	if pinnedPubKeySHA256 == "" {
		return nil, fmt.Errorf("PDMS pubkey not pinned - PDMS not deployed yet")
	}

	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return vsock.Dial(parentCID, pdmsVsockPort, nil)
			},
			TLSClientConfig: &tls.Config{
				Certificates:          []tls.Certificate{cert},
				InsecureSkipVerify:    true, // chain verification replaced by pinning below
				VerifyPeerCertificate: pinnedCertVerifier(pinnedPubKeySHA256),
			},
		},
	}, nil
}
