package main

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"fmt"

	scev1 "sce-unit/gen/scev1"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// decryptRecord decrypts one RecordEnvelope under the plaintext data key. pdm-service sends the envelope as
// base64, and the ciphertext is AES-256-GCM over a serialized google.protobuf.Struct.
func decryptRecord(dek []byte, envelopeB64 string) (*structpb.Struct, error) {
	raw, err := base64.StdEncoding.DecodeString(envelopeB64)
	if err != nil {
		return nil, fmt.Errorf("decode envelope: %w", err)
	}
	envelope := &scev1.RecordEnvelope{}
	if err := proto.Unmarshal(raw, envelope); err != nil {
		return nil, fmt.Errorf("parse envelope: %w", err)
	}

	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(envelope.GetCiphertext()) < gcm.Overhead() {
		return nil, fmt.Errorf("ciphertext too short")
	}
	// Go's GCM appends the auth tag to the ciphertext, matching how seeding built the envelope.
	plain, err := gcm.Open(nil, envelope.GetNonce(), envelope.GetCiphertext(), nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt record: %w", err)
	}

	data := &structpb.Struct{}
	if err := proto.Unmarshal(plain, data); err != nil {
		return nil, fmt.Errorf("parse record data: %w", err)
	}
	return data, nil
}
