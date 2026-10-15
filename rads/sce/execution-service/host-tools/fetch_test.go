package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFetchRecordsCheckpoint(t *testing.T) {
	for _, tc := range []struct {
		name       string
		pdmStatus  int
		logStatus  int
		badDest    bool
		wantError  bool
		wantEvents int
	}{
		{name: "fetch event precedes file write", pdmStatus: 200, logStatus: 202, wantEvents: 1},
		{name: "logging failure does not prevent writing", pdmStatus: 200, logStatus: 500, wantEvents: 1},
		{name: "write failure still records successful fetch", pdmStatus: 200, logStatus: 202, badDest: true, wantError: true, wantEvents: 1},
		{name: "fetch failure emits no successful checkpoint", pdmStatus: 500, logStatus: 202, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dest := filepath.Join(t.TempDir(), "records.json")
			if tc.badDest {
				dest = filepath.Join(dest, "missing", "records.json")
			}
			pdm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/records" || r.URL.Query().Get("algorithmId") != "algorithm" || r.Header.Get("X-Run-Id") != "run" {
					t.Error("missing PDM request identity")
				}
				w.WriteHeader(tc.pdmStatus)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"records": []map[string]string{{"recordId": "one"}, {"recordId": "two"}},
				})
			}))
			defer pdm.Close()
			events := make(chan map[string]string, 1)
			logs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if _, err := os.Stat(dest); !os.IsNotExist(err) {
					t.Error("records file exists before records-fetched")
				}
				var event map[string]string
				if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
					t.Error(err)
				}
				events <- event
				w.WriteHeader(tc.logStatus)
			}))
			defer logs.Close()

			err := fetchRecords([]string{pdm.URL, "algorithm", dest, "run", "1", logs.URL})
			if (err != nil) != tc.wantError {
				t.Fatalf("fetchRecords error = %v, wantError = %v", err, tc.wantError)
			}
			if len(events) != tc.wantEvents {
				t.Fatalf("received %d events, want %d", len(events), tc.wantEvents)
			}
			if tc.wantEvents > 0 {
				event := <-events
				if event["event"] != "records-fetched" || event["algorithmId"] != "algorithm" || event["runId"] != "run" {
					t.Fatalf("unexpected checkpoint: %v", event)
				}
				if _, err := time.Parse(time.RFC3339Nano, event["timestamp"]); err != nil {
					t.Fatal(err)
				}
			}
			if tc.wantError {
				return
			}
			body, err := os.ReadFile(dest)
			if err != nil {
				t.Fatal(err)
			}
			var result struct {
				Records []struct{ RecordID string }
			}
			if err := json.Unmarshal(body, &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Records) != 1 || result.Records[0].RecordID != "one" {
				t.Fatalf("requested record limit not preserved: %s", body)
			}
		})
	}
}
