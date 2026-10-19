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

type Client struct {
	Host       string
	HTTPClient *http.Client
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

	c.send("/events", body, "log event "+event)
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
	c.send("/subject-access", body, "subject-access log")
}

func (c *Client) send(path string, body []byte, label string) {
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+strings.TrimRight(c.Host, "/")+path, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
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
