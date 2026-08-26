package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

const logEventTimeout = 5 * time.Second

// runEvent is the constrained set of timeline events execution-service emits - keep in sync with log-service's
// RUN_EVENTS (the ingest authority rejects anything else).
type runEvent string

const (
	eventRunRequested    runEvent = "run-requested"
	eventEnclaveLaunched runEvent = "enclave-launched"
	eventLaunchFailed    runEvent = "launch-failed"
)

// logEvent fire-and-forgets one timeline event to log-service (over its public TLS URL - execution-service,
// unlike the enclave, trusts public CAs). The timestamp is this producer's own clock. Best-effort: a logging
// failure must never affect a run, so errors are only logged.
func logEvent(algorithmId, runId string, event runEvent, detail map[string]any) {
	if logHost == "" {
		return
	}

	body, err := json.Marshal(struct {
		AlgorithmId string         `json:"algorithmId"`
		RunId       string         `json:"runId"`
		Event       runEvent       `json:"event"`
		Timestamp   string         `json:"timestamp"`
		Detail      map[string]any `json:"detail,omitempty"`
	}{algorithmId, runId, event, time.Now().UTC().Format(time.RFC3339Nano), detail})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), logEventTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+logHost+"/events", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("execution-service: log event %q failed: %v", event, err)
		return
	}
	resp.Body.Close()
}
