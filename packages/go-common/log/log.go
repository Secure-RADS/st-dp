package log

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

const requestTimeout = 5 * time.Second

const (
	EventImageUploaded        = "image-uploaded"
	EventBuildStarted         = "build-started"
	EventAlgorithmRegistered  = "algorithm-registered"
	EventPCRsRegistered       = "pcrs-registered"
	EventKMSKeyProvisioned    = "kms-key-provisioned"
	EventBuildCompleted       = "build-completed"
	EventBuildFailed          = "build-failed"
	EventEnclaveStarted       = "enclave-started"
	EventUnitReady            = "unit-ready"
	EventAttested             = "attested"
	EventRecordsFetched       = "records-fetched"
	EventRecordsDecrypted     = "records-decrypted"
	EventRecordsStoredLocally = "records-stored-locally"
	EventDCAppCompleted       = "dc-app-completed"
	EventOutputSent           = "output-sent"
	EventRunFailed            = "run-failed"
)

type Client struct {
	Host       string
	HTTPClient *http.Client
	// Token returns the current access token, or "" before attestation. A nil Token means this producer
	// does not use the enclave channel and sends immediately without one (registry-service).
	Token func() string
}

// EmitEvent sends one event. Once a token is available it is attached; before attestation the event is
// sent without one and log-service records it as unauthenticated.
func (c *Client) EmitEvent(algorithmID string, runID *string, event string, detail map[string]any) {
	c.emit(algorithmID, runID, event, detail)
}

func (c *Client) emit(algorithmID string, runID *string, event string, detail map[string]any) {
	if c == nil || c.Host == "" || algorithmID == "" || (runID != nil && *runID == "") {
		return
	}

	body, err := json.Marshal(struct {
		AlgorithmID string         `json:"algorithmId"`
		RunID       *string        `json:"runId"`
		Event       string         `json:"event"`
		Timestamp   string         `json:"timestamp"`
		Detail      map[string]any `json:"detail,omitempty"`
	}{algorithmID, runID, event, time.Now().UTC().Format(time.RFC3339Nano), detail})
	if err != nil {
		return
	}

	c.send(body, "/events", "log event "+event, c.currentToken())
}

func (c *Client) currentToken() string {
	if c.Token == nil {
		return ""
	}
	return c.Token()
}

func (c *Client) send(body []byte, path, label, token string) {
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+strings.TrimRight(c.Host, "/")+path, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("%s failed: %v", label, err)
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		log.Printf("%s rejected with %s", label, resp.Status)
	}
}
