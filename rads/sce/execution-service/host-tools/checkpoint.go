package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const checkpointTimeout = 5 * time.Second

func checkpoint(args []string) error {
	if len(args) != 3 {
		return fmt.Errorf("usage: checkpoint <algorithmId> <runId> <event>")
	}
	return writeJSON(checkpointPayload(args[0], args[1], args[2]))
}

func checkpointPayload(algorithmID, runID, event string) map[string]any {
	return map[string]any{
		"algorithmId": algorithmID,
		"runId":       runID,
		"event":       event,
		"timestamp":   time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func postCheckpoint(endpoint, algorithmID, runID, event string) error {
	body, err := json.Marshal(checkpointPayload(algorithmID, runID, event))
	if err != nil {
		return fmt.Errorf("marshal checkpoint %s: %w", event, err)
	}
	client := &http.Client{Timeout: checkpointTimeout}
	resp, err := client.Post(endpoint, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("post checkpoint %s: %w", event, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("post checkpoint %s: HTTP %d", event, resp.StatusCode)
	}
	_, err = io.Copy(io.Discard, resp.Body)
	return err
}

func executorFinished(args []string) error {
	if len(args) != 4 {
		return fmt.Errorf("usage: executor-finished <status> <instanceId> <algorithmId> <runId>")
	}
	return writeJSON(map[string]any{
		"algorithmId": args[2],
		"runId":       args[3],
		"event":       "executor-finished",
		"timestamp":   time.Now().UTC().Format(time.RFC3339Nano),
		"detail": map[string]string{
			"status":     "exit:" + args[0],
			"instanceId": args[1],
		},
	})
}

func writeJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}
