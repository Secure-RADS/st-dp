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
// The bearer token is all pdm-service needs - it derives the algorithmId and runId from the token's claims,
// never from us. The returned data subject ids line up with the returned records.
func fetchAllRecords(cfg runConfig, limit int) ([]pdmRecord, []string, error) {
	client := cfg.pdm().client()

	var records []pdmRecord
	var subjectIDs []string
	cursor := ""
	for page := 1; ; page++ {
		// Always read the live access token; refreshLoop refreshes before expiry — never reuse the attest-time string.
		accessToken, ok := CurrentAccessToken()
		if !ok {
			return nil, nil, fmt.Errorf("GET /records page %d: no access token", page)
		}

		endpoint := "https://" + cfg.PdmHost + "/records"
		if cursor != "" {
			endpoint += "?cursor=" + url.QueryEscape(cursor)
		}

		ctx, cancel := context.WithTimeout(context.Background(), pdmRequestTimeout)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			cancel()
			return nil, nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)

		resp, err := client.Do(req)
		if err != nil {
			cancel()
			return nil, nil, fmt.Errorf("GET /records page %d: %w", page, err)
		}

		if resp.StatusCode != http.StatusOK {
			respBody, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			cancel()
			return nil, nil, fmt.Errorf("pdm-service returned %s: %s", resp.Status, respBody)
		}

		var body struct {
			Records        []pdmRecord `json:"records"`
			DataSubjectIds []string    `json:"dataSubjectIds"`
			NextCursor     *string     `json:"nextCursor"`
		}
		err = json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()
		cancel()
		if err != nil {
			return nil, nil, fmt.Errorf("decode /records page %d: %w", page, err)
		}

		records = append(records, body.Records...)
		subjectIDs = append(subjectIDs, body.DataSubjectIds...)
		if limit > 0 && len(records) >= limit {
			return records[:limit], subjectIDs[:min(len(subjectIDs), limit)], nil
		}
		if body.NextCursor == nil || *body.NextCursor == "" {
			return records, subjectIDs, nil
		}
		cursor = *body.NextCursor
	}
}

func uniqueIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
