package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
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

func attest(cfg runConfig, runID, runSecret string) (tokenPair, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		return tokenPair{}, fmt.Errorf("generate ephemeral key: %w", err)
	}
	pubKey := elliptic.Marshal(elliptic.P384(), priv.PublicKey.X, priv.PublicKey.Y)

	// The verifier issues the nonce, so the document it receives is bound to this specific /attest request.
	challenge, err := fetchChallenge(cfg, runID, runSecret)
	if err != nil {
		return tokenPair{}, fmt.Errorf("request challenge: %w", err)
	}
	nonce, err := base64.RawURLEncoding.DecodeString(challenge)
	if err != nil {
		return tokenPair{}, fmt.Errorf("decode challenge: %w", err)
	}

	sess, err := nsm.OpenDefaultSession()
	if err != nil {
		return tokenPair{}, fmt.Errorf("open NSM session: %w", err)
	}
	defer sess.Close()

	// user_data binds the attested session to the run execution-service registered this secret for; /challenge
	// already rejected a host that does not hold it.
	userData := sha256.Sum256([]byte(runSecret))
	res, err := sess.Send(&request.Attestation{Nonce: nonce, PublicKey: pubKey, UserData: userData[:]})
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
		RunId               string `json:"runId"`
		AttestationDocument string `json:"attestationDocument"`
		Challenge           string `json:"challenge"`
	}{
		AlgorithmId:         cfg.AlgorithmId,
		RunId:               runID,
		AttestationDocument: base64.StdEncoding.EncodeToString(res.Attestation.Document),
		Challenge:           challenge,
	})
	if err != nil {
		return tokenPair{}, err
	}

	return postForTokens(cfg, "/attest", body)
}

// fetchChallenge gets a single-use nonce from verifier-service before the NSM attestation request, so the
// document it signs is valid for one /attest call only.
func fetchChallenge(cfg runConfig, runID, runSecret string) (string, error) {
	body, err := json.Marshal(struct {
		AlgorithmId string `json:"algorithmId"`
		RunId       string `json:"runId"`
		RunSecret   string `json:"runSecret"`
	}{AlgorithmId: cfg.AlgorithmId, RunId: runID, RunSecret: runSecret})
	if err != nil {
		return "", err
	}

	respBody, err := postVerifier(cfg, "/challenge", body)
	if err != nil {
		return "", err
	}

	var challenge struct {
		Challenge string `json:"challenge"`
	}
	if err := json.Unmarshal(respBody, &challenge); err != nil {
		return "", fmt.Errorf("decode challenge response: %w", err)
	}
	if challenge.Challenge == "" {
		return "", fmt.Errorf("verifier-service returned an empty challenge")
	}
	return challenge.Challenge, nil
}

// refreshTokens exchanges a still-valid refresh token for a new access token, without a fresh attestation
// document - see verifier-service's /refresh handler.
func refreshTokens(cfg runConfig, runID, refreshToken string) (tokenPair, error) {
	body, err := json.Marshal(struct {
		RunId        string `json:"runId"`
		RefreshToken string `json:"refreshToken"`
	}{RunId: runID, RefreshToken: refreshToken})
	if err != nil {
		return tokenPair{}, err
	}

	return postForTokens(cfg, "/refresh", body)
}

// postForTokens POSTs a JSON body to a verifier-service endpoint over the pinned vsock-proxy transport and
// decodes the {accessToken, refreshToken, accessTokenExpiresAt} response shared by /attest and /refresh.
func postForTokens(cfg runConfig, path string, body []byte) (tokenPair, error) {
	respBody, err := postVerifier(cfg, path, body)
	if err != nil {
		return tokenPair{}, err
	}

	var tokens struct {
		AccessToken          string `json:"accessToken"`
		RefreshToken         string `json:"refreshToken"`
		AccessTokenExpiresAt string `json:"accessTokenExpiresAt"`
	}
	if err := json.Unmarshal(respBody, &tokens); err != nil {
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

// postVerifier sends a JSON body over the pinned vsock-proxy transport and returns the body of a 200 response.
func postVerifier(cfg runConfig, path string, body []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), attestRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+cfg.VerifierHost+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := cfg.verifier().client()
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("POST %s: %w", path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read %s response: %w", path, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("verifier-service returned %s: %s", resp.Status, respBody)
	}
	return respBody, nil
}
