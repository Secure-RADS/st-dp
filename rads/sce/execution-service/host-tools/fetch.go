package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// One shared client keeps a single TLS session across PDM pages; fresh dials dominated large fetches.
var pdmHTTP = &http.Client{Timeout: 60 * time.Second}

type pdmRecord struct {
	RecordId      string          `json:"recordId"`
	DataSubjectId string          `json:"dataSubjectId"`
	Data          json.RawMessage `json:"data"`
}

// recordsFileRecord is the DC app's view: the data subject id never reaches records.json.
type recordsFileRecord struct {
	RecordId string          `json:"recordId"`
	Data     json.RawMessage `json:"data"`
}

type pdmPage struct {
	Records    []pdmRecord `json:"records"`
	NextCursor string      `json:"nextCursor"`
}

func fetchRecords(args []string) error {
	if len(args) != 7 {
		return fmt.Errorf("usage: fetch-records <pdmUrl> <algorithmId> <dest> <runId> <size> <logEventsUrl> <subjectsPath>")
	}
	base, algorithmID, dest, runID, sizeArg, subjectsPath := args[0], args[1], args[2], args[3], args[4], args[6]

	var maxRecords int
	if sizeArg != "" {
		n, err := strconv.Atoi(sizeArg)
		if err != nil {
			return fmt.Errorf("size: %w", err)
		}
		maxRecords = n
	}

	records, pages, err := downloadRecords(base, algorithmID, runID, maxRecords)
	if err != nil {
		return err
	}
	if err := postCheckpoint(args[5], algorithmID, runID, "records-fetched"); err != nil {
		fmt.Fprintf(os.Stderr, "pdm: %v\n", err)
	}

	subjectIDs := uniqueDataSubjectIDs(records)
	if err := writeSubjectIDs(subjectsPath, subjectIDs); err != nil {
		return err
	}

	stripped := make([]recordsFileRecord, 0, len(records))
	for _, rec := range records {
		stripped = append(stripped, recordsFileRecord{RecordId: rec.RecordId, Data: rec.Data})
	}
	body, err := json.Marshal(struct {
		AlgorithmId string              `json:"algorithmId"`
		Pages       int                 `json:"pages"`
		Records     []recordsFileRecord `json:"records"`
	}{AlgorithmId: algorithmID, Pages: pages, Records: stripped})
	if err != nil {
		return err
	}
	if err := os.WriteFile(dest, body, 0o644); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "pdm: downloaded %d records in %d page(s) to %s\n", len(records), pages, dest)
	return nil
}

func uniqueDataSubjectIDs(records []pdmRecord) []string {
	seen := make(map[string]struct{}, len(records))
	ids := make([]string, 0, len(records))
	for _, rec := range records {
		if rec.DataSubjectId == "" {
			continue
		}
		if _, ok := seen[rec.DataSubjectId]; ok {
			continue
		}
		seen[rec.DataSubjectId] = struct{}{}
		ids = append(ids, rec.DataSubjectId)
	}
	return ids
}

func writeSubjectIDs(path string, ids []string) error {
	body, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func downloadRecords(base, algorithmID, runID string, maxRecords int) ([]pdmRecord, int, error) {
	parsed, err := url.Parse(base)
	if err != nil {
		return nil, 0, err
	}

	var records []pdmRecord
	var cursor string
	pages := 0
	for {
		q := url.Values{"algorithmId": {algorithmID}}
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		reqURL := *parsed
		reqURL.Path = strings.TrimRight(parsed.Path, "/") + "/records"
		reqURL.RawQuery = q.Encode()

		req, err := http.NewRequest(http.MethodGet, reqURL.String(), nil)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("X-Run-Id", runID)

		resp, err := pdmHTTP.Do(req)
		if err != nil {
			return nil, 0, err
		}
		payload, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, 0, readErr
		}
		if resp.StatusCode != http.StatusOK {
			return nil, 0, fmt.Errorf("pdm-service returned %d: %s", resp.StatusCode, payload)
		}

		var page pdmPage
		if err := json.Unmarshal(payload, &page); err != nil {
			return nil, 0, err
		}
		pages++
		records = append(records, page.Records...)
		if maxRecords > 0 && len(records) >= maxRecords {
			return records[:maxRecords], pages, nil
		}
		if page.NextCursor == "" {
			return records, pages, nil
		}
		cursor = page.NextCursor
	}
}
