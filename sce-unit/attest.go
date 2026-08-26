package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/hf/nsm"
	"github.com/hf/nsm/request"
)

const attestRequestTimeout = 30 * time.Second

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

func logAttestOutcome(cfg runConfig) {
	accessToken, _, err := attest(cfg)
	if err != nil {
		log.Printf("sce-unit: attestation failed: %v", err)
		return
	}
	log.Printf("sce-unit: attested successfully, got access token (len %d)", len(accessToken))
}
