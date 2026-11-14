package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const pdmRequestTimeout = 60 * time.Second

type pdmRecord struct {
	RecordId string          `json:"recordId"`
	Data     json.RawMessage `json:"data"`
}

// fetchAllRecords pulls personal-data records for this enclave's algorithm from the PDM service, following
// pagination cursors until the dataset ends or `limit` records have been read (limit 0 = the whole dataset).
// The bearer token is all pdm-service needs - it derives the algorithmId from the token's attestation
// session via verifier-service, never from us.
func fetchAllRecords(cfg runConfig, runID string, limit int) ([]pdmRecord, error) {
	client := cfg.pdm().client()

	var records []pdmRecord
	cursor := ""
	for page := 1; ; page++ {
		// Always read the live access token; refreshLoop refreshes before expiry — never reuse the attest-time string.
		accessToken, ok := CurrentAccessToken()
		if !ok {
			return nil, fmt.Errorf("GET /records page %d: no access token", page)
		}

		endpoint := "https://" + cfg.PdmHost + "/records"
		if cursor != "" {
			endpoint += "?cursor=" + url.QueryEscape(cursor)
		}

		ctx, cancel := context.WithTimeout(context.Background(), pdmRequestTimeout)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			cancel()
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("X-Run-Id", runID)

		resp, err := client.Do(req)
		if err != nil {
			cancel()
			return nil, fmt.Errorf("GET /records page %d: %w", page, err)
		}

		if resp.StatusCode != http.StatusOK {
			respBody, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			cancel()
			return nil, fmt.Errorf("pdm-service returned %s: %s", resp.Status, respBody)
		}

		var body struct {
			Records    []pdmRecord `json:"records"`
			NextCursor *string     `json:"nextCursor"`
		}
		err = json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()
		cancel()
		if err != nil {
			return nil, fmt.Errorf("decode /records page %d: %w", page, err)
		}

		records = append(records, body.Records...)
		if limit > 0 && len(records) >= limit {
			return records[:limit], nil
		}
		if body.NextCursor == nil || *body.NextCursor == "" {
			return records, nil
		}
		cursor = *body.NextCursor
	}
}
