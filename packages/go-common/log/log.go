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
	EventExecutorReady        = "executor-ready"
	EventArtifactRetrieved    = "artifact-retrieved"
	EventEnclaveLaunched      = "enclave-launched"
)

type pendingEvent struct {
	body  []byte
	label string
}

type Client struct {
	Host       string
	HTTPClient *http.Client
	// Token returns the current access token, or "" before attestation. A nil Token means this producer
	// does not use the enclave channel and sends immediately without one (registry-service).
	Token func() string

	mu      sync.Mutex
	pending []pendingEvent
}

// EmitEvent emits an enclave-originated event. Before a token is available it is queued and sent by Flush.
func (c *Client) EmitEvent(algorithmID string, runID *string, event string, detail map[string]any) {
	c.emit("", algorithmID, runID, event, "", detail)
}

// EmitHostEvent emits an event relayed from the host. It travels over the enclave's authenticated channel
// but carries origin=host so the log does not present host claims as enclave claims.
func (c *Client) EmitHostEvent(algorithmID string, runID *string, event string, detail map[string]any) {
	c.emit("host", algorithmID, runID, event, "", detail)
}

// EmitHostEventAt preserves the host-supplied timestamp. The timestamp orders the timeline; it is not
// evidence of when the event happened, because the host supplies it.
func (c *Client) EmitHostEventAt(algorithmID string, runID *string, event, timestamp string, detail map[string]any) {
	c.emit("host", algorithmID, runID, event, timestamp, detail)
}

func (c *Client) emit(origin, algorithmID string, runID *string, event, timestamp string, detail map[string]any) {
	if c == nil || c.Host == "" || algorithmID == "" || (runID != nil && *runID == "") {
		return
	}

	if timestamp == "" {
		timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}
	body, err := json.Marshal(struct {
		AlgorithmID string         `json:"algorithmId"`
		RunID       *string        `json:"runId"`
		Event       string         `json:"event"`
		Timestamp   string         `json:"timestamp"`
		Detail      map[string]any `json:"detail,omitempty"`
		Origin      string         `json:"origin,omitempty"`
	}{algorithmID, runID, event, timestamp, detail, origin})
	if err != nil {
		return
	}

	token := c.currentToken()
	if c.Token != nil && token == "" {
		c.mu.Lock()
		// Re-check under the lock: setTokens + Flush may have run between the read above and here, and a
		// late append would never be flushed.
		if latest := c.currentToken(); latest != "" {
			c.mu.Unlock()
			c.send(body, "/events", "log event "+event, latest)
			return
		}
		c.pending = append(c.pending, pendingEvent{body: body, label: "log event " + event})
		c.mu.Unlock()
		return
	}
	c.send(body, "/events", "log event "+event, token)
}

func (c *Client) currentToken() string {
	if c.Token == nil {
		return ""
	}
	return c.Token()
}

// Flush sends the queued pre-attestation events in order with the current token.
func (c *Client) Flush() {
	token := c.currentToken()
	if token == "" {
		return
	}

	c.mu.Lock()
	queued := c.pending
	c.pending = nil
	c.mu.Unlock()

	for _, item := range queued {
		c.send(item.body, "/events", item.label, token)
	}
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

	c.send(body, "/subject-access", "subject-access log", "")
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
