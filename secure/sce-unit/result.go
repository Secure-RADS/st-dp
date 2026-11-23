package main

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
)

const resultSignatureContext = "sce-result-v1\n"

type resultPayload struct {
	RunID       string `json:"runId"`
	AlgorithmID string `json:"algorithmId"`
	Status      string `json:"status"`
	Output      string `json:"output"`
	Diag        any    `json:"diag,omitempty"`
}

type signedResult struct {
	RunID       string `json:"runId"`
	AlgorithmID string `json:"algorithmId"`
	InstanceID  string `json:"instanceId,omitempty"`
	Payload     string `json:"payload"`
	Signature   string `json:"signature"`
}

var resultSigner struct {
	mu  sync.RWMutex
	key *ecdsa.PrivateKey
}

func setResultSigner(key *ecdsa.PrivateKey) {
	resultSigner.mu.Lock()
	defer resultSigner.mu.Unlock()
	resultSigner.key = key
}

func getResultSigner() *ecdsa.PrivateKey {
	resultSigner.mu.RLock()
	defer resultSigner.mu.RUnlock()
	return resultSigner.key
}

// sendResult signs the enclave-owned result fields and streams the envelope to the host. The host may add
// instanceId, but it cannot change the signed payload or signature without the consumer rejecting it.
func sendResult(info runInfo, p resultPayload) error {
	key := getResultSigner()
	if key == nil {
		return fmt.Errorf("no result signing key: enclave has not attested")
	}

	payload, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("marshal result payload: %w", err)
	}
	digest := sha256.Sum256(append([]byte(resultSignatureContext), payload...))
	signature, err := ecdsa.SignASN1(rand.Reader, key, digest[:])
	if err != nil {
		return fmt.Errorf("sign result payload: %w", err)
	}

	envelope, err := json.Marshal(signedResult{
		RunID:       p.RunID,
		AlgorithmID: p.AlgorithmID,
		InstanceID:  info.InstanceID,
		Payload:     base64.StdEncoding.EncodeToString(payload),
		Signature:   base64.StdEncoding.EncodeToString(signature),
	})
	if err != nil {
		return fmt.Errorf("marshal signed result: %w", err)
	}
	return sendSQSResult(info, envelope)
}
