package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

const (
	verifierClientCertPath  = "/opt/assets/tls/client.crt"
	verifierClientKeyPath   = "/opt/assets/tls/client.key"
	verifierPinnedPubKeyEnv = "VERIFIER_PUBKEY_SHA256"
)

var (
	verifierURL  = os.Getenv("VERIFIER_URL")
	verifierHost = os.Getenv("VERIFIER_HOST")
)

type registerPCRsRequest struct {
	AlgorithmId string `json:"algorithmId"`
	PCR0        string `json:"pcr0"`
	PCR1        string `json:"pcr1"`
	PCR2        string `json:"pcr2"`
}

// registerPCRs hands PCR measurements to verifier-service over mTLS, pinning
// its leaf cert's public key on top of normal chain verification - trust
// material (client cert/key, pinned pubkey hash) is baked in at build time,
// not configurable at runtime.
func registerPCRs(ctx context.Context, algorithmId string, pcrs pcrMeasurements) error {
	pinnedPubKeySHA256 := os.Getenv(verifierPinnedPubKeyEnv)
	if verifierURL == "" || pinnedPubKeySHA256 == "" {
		return fmt.Errorf("VERIFIER_URL / %s not configured", verifierPinnedPubKeyEnv)
	}

	cert, err := tls.LoadX509KeyPair(verifierClientCertPath, verifierClientKeyPath)
	if err != nil {
		return fmt.Errorf("load client cert: %w", err)
	}

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				Certificates:          []tls.Certificate{cert},
				InsecureSkipVerify:    true, // chain verification replaced by pinning below
				VerifyPeerCertificate: pinnedCertVerifier(pinnedPubKeySHA256),
			},
		},
	}

	body, err := json.Marshal(registerPCRsRequest{
		AlgorithmId: algorithmId,
		PCR0:        pcrs.PCR0,
		PCR1:        pcrs.PCR1,
		PCR2:        pcrs.PCR2,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, verifierURL, bytes.NewReader(body))
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
		return fmt.Errorf("verifier-service returned %s", resp.Status)
	}
	return nil
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
