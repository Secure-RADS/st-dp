package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"

	"golang.org/x/sys/unix"
)

// The host serves this run's runId on this vsock port - the enclave takes no user-data of its own, so it has
// no other way to learn the per-run id it was launched for (the EIF only carries the per-algorithm config).
const hostRunIDPort = 5001

const logEventTimeout = 5 * time.Second

// runEvent is the constrained set of timeline events sce-unit emits - keep in sync with log-service's
// RUN_EVENTS (the ingest authority rejects anything else).
type runEvent string

const (
	eventEnclaveStarted runEvent = "enclave-started"
	eventAttested       runEvent = "attested"
	eventRecordsFetched runEvent = "records-fetched"
	eventDCAppCompleted runEvent = "dc-app-completed"
	eventOutputSent     runEvent = "output-sent"
	eventRunFailed      runEvent = "run-failed"
)

// readRunID fetches the runId the host is serving on hostRunIDPort. Best-effort: an empty string just means
// enclave-side events go unattributed to a run, not a failure.
func readRunID() string {
	fd, err := unix.Socket(unix.AF_VSOCK, unix.SOCK_STREAM, 0)
	if err != nil {
		return ""
	}
	defer unix.Close(fd)

	addr := &unix.SockaddrVM{CID: hostCID, Port: hostRunIDPort}
	for i := 0; ; i++ {
		if err := unix.Connect(fd, addr); err == nil {
			break
		}
		if i >= vsockRetryLimit {
			return ""
		}
		time.Sleep(vsockRetryWait)
	}

	var buf bytes.Buffer
	chunk := make([]byte, 256)
	for {
		n, err := unix.Read(fd, chunk)
		if n > 0 {
			buf.Write(chunk[:n])
		}
		if err != nil || n == 0 {
			break
		}
	}
	return buf.String()
}

// logEvent fire-and-forgets one timeline event to log-service over the pinned vsock transport. The timestamp is
// when the event happened here (the producer's own clock), which is what log-service records. Errors are
// swallowed - logging must never affect the run.
func logEvent(cfg runConfig, runID string, event runEvent, detail map[string]any) {
	if cfg.LogHost == "" || runID == "" {
		return
	}

	body, err := json.Marshal(struct {
		AlgorithmId string         `json:"algorithmId"`
		RunId       string         `json:"runId"`
		Event       runEvent       `json:"event"`
		Timestamp   string         `json:"timestamp"`
		Detail      map[string]any `json:"detail,omitempty"`
	}{cfg.AlgorithmId, runID, event, time.Now().UTC().Format(time.RFC3339Nano), detail})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), logEventTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+cfg.LogHost+"/events", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := cfg.logSvc().client().Do(req)
	if err != nil {
		log.Printf("sce-unit: log event %q failed: %v", event, err)
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}
