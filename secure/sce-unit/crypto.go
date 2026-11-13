package main

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// recordEnvelope is the shape pdm-service stores each record's Data as: AES-256-GCM ciphertext of the
// original JSON, with the nonce and auth tag alongside. The data key that decrypts it is unwrapped via KMS.
type recordEnvelope struct {
	V     string `json:"v"`
	Nonce string `json:"nonce"`
	CT    string `json:"ct"`
}

// decryptRecord decrypts one envelope under the plaintext data key and returns the original record object.
func decryptRecord(dek []byte, blob json.RawMessage) (json.RawMessage, error) {
	var env recordEnvelope
	if err := json.Unmarshal(blob, &env); err != nil {
		return nil, fmt.Errorf("parse envelope: %w", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(env.Nonce)
	if err != nil {
		return nil, fmt.Errorf("decode nonce: %w", err)
	}
	body, err := base64.StdEncoding.DecodeString(env.CT)
	if err != nil {
		return nil, fmt.Errorf("decode ciphertext: %w", err)
	}

	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(body) < gcm.Overhead() {
		return nil, fmt.Errorf("ciphertext too short")
	}
	// Go's GCM appends the auth tag to the ciphertext, matching how seeding built the envelope.
	plain, err := gcm.Open(nil, nonce, body, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt record: %w", err)
	}
	return plain, nil
}
