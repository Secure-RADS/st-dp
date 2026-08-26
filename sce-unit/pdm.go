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

// fetchAllRecords pulls every personal-data record for this enclave's algorithm from the PDM service,
// following pagination cursors until exhausted. The bearer token is all pdm-service needs - it derives the
// algorithmId from the token's attestation session via verifier-service, never from us.
func fetchAllRecords(cfg runConfig, accessToken string) ([]json.RawMessage, error) {
	client := pinnedVsockHTTPClient(cfg.PdmHost, cfg.PdmPubKeySHA256, pdmProxyPort)

	var records []json.RawMessage
	cursor := ""
	for page := 1; ; page++ {
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
			Records    []json.RawMessage `json:"records"`
			NextCursor *string           `json:"nextCursor"`
		}
		err = json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()
		cancel()
		if err != nil {
			return nil, fmt.Errorf("decode /records page %d: %w", page, err)
		}

		records = append(records, body.Records...)
		if body.NextCursor == nil || *body.NextCursor == "" {
			return records, nil
		}
		cursor = *body.NextCursor
	}
}
