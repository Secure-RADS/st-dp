package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

const subjectAccessTimeout = 5 * time.Second

// subjectAccessBatch matches log-service's per-request cap, so large datasets are sent as several batches.
const subjectAccessBatch = 1000

// logSubjectAccess posts the DSAR trail after the DC app has completed successfully. The ids come from
// the PDM records fetched for this run; they are kept out of records.json.
func logSubjectAccess(args []string) error {
	if len(args) != 3 {
		return fmt.Errorf("usage: subject-access <url> <algorithmId> <runId>")
	}
	endpoint, algorithmID, runID := args[0], args[1], args[2]

	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		return fmt.Errorf("read subject ids: %w", err)
	}
	var dataSubjectIDs []string
	if err := json.Unmarshal(raw, &dataSubjectIDs); err != nil {
		return fmt.Errorf("parse subject ids: %w", err)
	}
	if len(dataSubjectIDs) == 0 {
		return nil
	}

	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	bodies := make([][]byte, 0, (len(dataSubjectIDs)+subjectAccessBatch-1)/subjectAccessBatch)
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
		bodies = append(bodies, body)
	}

	client := &http.Client{Timeout: subjectAccessTimeout}
	errs := make(chan error, len(bodies))
	var wg sync.WaitGroup
	for _, body := range bodies {
		wg.Add(1)
		go func(body []byte) {
			defer wg.Done()
			resp, err := client.Post(endpoint, "application/json", bytes.NewReader(body))
			if err != nil {
				errs <- err
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
				errs <- fmt.Errorf("subject-access rejected with %s", resp.Status)
			}
		}(body)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		return err
	}
	return nil
}
