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
	"net/http"
	"time"

	"github.com/hf/nsm"
	"github.com/hf/nsm/request"
)

const attestRequestTimeout = 30 * time.Second

func attest(cfg runConfig) (tokenPair, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		return tokenPair{}, fmt.Errorf("generate ephemeral key: %w", err)
	}
	pubKey := elliptic.Marshal(elliptic.P384(), priv.PublicKey.X, priv.PublicKey.Y)

	nonce := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return tokenPair{}, fmt.Errorf("generate nonce: %w", err)
	}

	sess, err := nsm.OpenDefaultSession()
	if err != nil {
		return tokenPair{}, fmt.Errorf("open NSM session: %w", err)
	}
	defer sess.Close()

	res, err := sess.Send(&request.Attestation{Nonce: nonce, PublicKey: pubKey})
	if err != nil {
		return tokenPair{}, fmt.Errorf("request attestation document: %w", err)
	}
	if res.Error != "" {
		return tokenPair{}, fmt.Errorf("NSM: %s", res.Error)
	}
	if res.Attestation == nil || res.Attestation.Document == nil {
		return tokenPair{}, fmt.Errorf("NSM returned no attestation document")
	}

	body, err := json.Marshal(struct {
		AlgorithmId         string `json:"algorithmId"`
		AttestationDocument string `json:"attestationDocument"`
	}{
		AlgorithmId:         cfg.AlgorithmId,
		AttestationDocument: base64.StdEncoding.EncodeToString(res.Attestation.Document),
	})
	if err != nil {
		return tokenPair{}, err
	}

	return postForTokens(cfg, "/attest", body)
}

// refreshTokens exchanges a still-valid refresh token for a new access token, without a fresh attestation
// document - see verifier-service's /refresh handler.
func refreshTokens(cfg runConfig, refreshToken string) (tokenPair, error) {
	body, err := json.Marshal(struct {
		RefreshToken string `json:"refreshToken"`
	}{RefreshToken: refreshToken})
	if err != nil {
		return tokenPair{}, err
	}

	return postForTokens(cfg, "/refresh", body)
}

// postForTokens POSTs a JSON body to a verifier-service endpoint over the pinned vsock-proxy transport and
// decodes the {accessToken, refreshToken, accessTokenExpiresAt} response shared by /attest and /refresh.
func postForTokens(cfg runConfig, path string, body []byte) (tokenPair, error) {
	ctx, cancel := context.WithTimeout(context.Background(), attestRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+cfg.VerifierHost+path, bytes.NewReader(body))
	if err != nil {
		return tokenPair{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := cfg.verifier().client()
	resp, err := client.Do(req)
	if err != nil {
		return tokenPair{}, fmt.Errorf("POST %s: %w", path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return tokenPair{}, fmt.Errorf("verifier-service returned %s: %s", resp.Status, respBody)
	}

	var tokens struct {
		AccessToken          string `json:"accessToken"`
		RefreshToken         string `json:"refreshToken"`
		AccessTokenExpiresAt string `json:"accessTokenExpiresAt"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil {
		return tokenPair{}, fmt.Errorf("decode token response: %w", err)
	}

	expiresAt, err := time.Parse(time.RFC3339, tokens.AccessTokenExpiresAt)
	if err != nil {
		return tokenPair{}, fmt.Errorf("parse accessTokenExpiresAt: %w", err)
	}

	return tokenPair{
		AccessToken:          tokens.AccessToken,
		RefreshToken:         tokens.RefreshToken,
		AccessTokenExpiresAt: expiresAt,
	}, nil
}
