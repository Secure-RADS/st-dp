package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	enclave "github.com/edgebitio/nitro-enclaves-sdk-go"
)

const kmsRequestTimeout = 30 * time.Second

// decryptDataKey asks kms-service to unwrap this algorithm's data key. kms-service authenticates the access
// token, looks up the algorithm's CMK and wrapped data key, and calls KMS Decrypt with this enclave's
// attestation document as the Recipient - so KMS returns CiphertextForRecipient, which only this enclave's
// ephemeral private key can unwrap. The enclave holds no AWS credentials and never reaches KMS directly.
func decryptDataKey(cfg runConfig) ([]byte, error) {
	handle, err := enclave.GetOrInitializeHandle()
	if err != nil {
		return nil, fmt.Errorf("initialize enclave handle: %w", err)
	}
	attestationDocument, err := handle.Attest(enclave.AttestationOptions{})
	if err != nil {
		return nil, fmt.Errorf("request attestation document: %w", err)
	}

	accessToken, ok := CurrentAccessToken()
	if !ok {
		return nil, fmt.Errorf("decrypt data key: no access token")
	}

	body, err := json.Marshal(struct {
		AttestationDocument string `json:"attestationDocument"`
	}{AttestationDocument: base64.StdEncoding.EncodeToString(attestationDocument)})
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), kmsRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+cfg.KmsHost+"/decrypt", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := cfg.kmsSvc().client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("POST /decrypt: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("kms-service returned %s: %s", resp.Status, respBody)
	}

	var out struct {
		CiphertextForRecipient string `json:"ciphertextForRecipient"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode /decrypt response: %w", err)
	}
	wrapped, err := base64.StdEncoding.DecodeString(out.CiphertextForRecipient)
	if err != nil || len(wrapped) == 0 {
		return nil, fmt.Errorf("decode ciphertextForRecipient: %w", err)
	}

	key, err := handle.DecryptKMSEnvelopedKey(wrapped)
	if err != nil {
		return nil, fmt.Errorf("unwrap KMS recipient payload: %w", err)
	}
	return key, nil
}
