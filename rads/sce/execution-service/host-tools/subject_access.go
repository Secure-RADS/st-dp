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

const subjectAccessTimeout = 5 * time.Second

// subjectAccessBatch matches log-service's per-request cap, so large datasets are sent as several batches.
const subjectAccessBatch = 1000

// logSubjectAccess posts the DSAR trail after the DC app has completed successfully. The ids come from
// the PDM records fetched for this run; they are kept out of records.json.
func logSubjectAccess(args []string) error {
	if len(args) != 4 {
		return fmt.Errorf("usage: subject-access <url> <algorithmId> <runId> <subjectsPath>")
	}
	endpoint, algorithmID, runID, subjectsPath := args[0], args[1], args[2], args[3]

	raw, err := os.ReadFile(subjectsPath)
	if err != nil {
		return fmt.Errorf("read %s: %w", subjectsPath, err)
	}
	var dataSubjectIDs []string
	if err := json.Unmarshal(raw, &dataSubjectIDs); err != nil {
		return fmt.Errorf("parse %s: %w", subjectsPath, err)
	}
	if len(dataSubjectIDs) == 0 {
		return nil
	}

	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	client := &http.Client{Timeout: subjectAccessTimeout}
	for start := 0; start < len(dataSubjectIDs); start += subjectAccessBatch {
		end := min(start+subjectAccessBatch, len(dataSubjectIDs))
		body, err := json.Marshal(struct {
			AlgorithmID    string   `json:"algorithmId"`
			RunID          string   `json:"runId"`
			DataSubjectIDs []string `json:"dataSubjectIds"`
			Timestamp      string   `json:"timestamp"`
		}{
			AlgorithmID:    algorithmID,
			RunID:          runID,
			DataSubjectIDs: dataSubjectIDs[start:end],
			Timestamp:      timestamp,
		})
		if err != nil {
			return err
		}

		resp, err := client.Post(endpoint, "application/json", bytes.NewReader(body))
		if err != nil {
			return err
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			return fmt.Errorf("subject-access rejected with %s", resp.Status)
		}
	}
	return nil
}
