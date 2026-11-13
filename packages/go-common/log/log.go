package log

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
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
	// AccessToken returns the current attested bearer token. Nil means the producer is not an enclave and
	// posts unauthenticated (build and host-side events are exempt at ingest).
	AccessToken func() string

	mu      sync.Mutex
	pending []pendingEvent
}

type pendingEvent struct {
	path  string
	body  []byte
	label string
}

// Flush sends events queued before the enclave had a token. sce-unit calls it once attestation completes.
func (c *Client) Flush() {
	if c == nil || c.AccessToken == nil {
		return
	}
	token := c.AccessToken()
	if token == "" {
		return
	}

	c.mu.Lock()
	pending := c.pending
	c.pending = nil
	c.mu.Unlock()

	for _, e := range pending {
		c.post(e.path, e.body, e.label, token)
	}
}

func (c *Client) EmitEvent(algorithmID string, runID *string, event string, detail map[string]any) {
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

	c.deliver("/events", body, "log event "+event)
}

func (c *Client) EmitSubjectAccess(algorithmID, runID string, dataSubjectIDs []string) {
	if c == nil || c.Host == "" || algorithmID == "" || runID == "" || len(dataSubjectIDs) == 0 {
		return
	}

	body, err := json.Marshal(struct {
		AlgorithmID    string   `json:"algorithmId"`
		RunID          string   `json:"runId"`
		DataSubjectIDs []string `json:"dataSubjectIds"`
		Timestamp      string   `json:"timestamp"`
	}{algorithmID, runID, dataSubjectIDs, time.Now().UTC().Format(time.RFC3339Nano)})
	if err != nil {
		return
	}
	c.deliver("/subject-access", body, "subject-access log")
}

// deliver buffers until an enclave has attested. A producer without an AccessToken provider is not an
// enclave, so it sends straight through unauthenticated.
func (c *Client) deliver(path string, body []byte, label string) {
	token := ""
	if c.AccessToken != nil {
		token = c.AccessToken()
	}
	if c.AccessToken != nil && token == "" {
		c.mu.Lock()
		c.pending = append(c.pending, pendingEvent{path, body, label})
		c.mu.Unlock()
		return
	}
	c.post(path, body, label, token)
}

func (c *Client) post(path string, body []byte, label, token string) {
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
