package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
)

const costEventTimeout = time.Second

// costPhase/costService/costOperation mirror cost-service's enums (the ingest authority rejects anything
// else) - keep in sync with cost-service/src/lib/cost.ts.
type costPhase string

type costService string

type costOperation string

const (
	phaseBuild costPhase = "build"

	serviceS3       costService = "s3"
	serviceDynamoDB costService = "dynamodb"

	opS3Put       costOperation = "put"
	opDynamoRead  costOperation = "read"
	opDynamoWrite costOperation = "write"
)

// costEvent fire-and-forgets one metered AWS operation to cost-service, keyed by (algorithmId, buildId). The
// quantity unit is fixed by the operation (put = requests, read/write = item bytes). Best-effort: a metering
// failure must never fail a build, so errors are only logged, and an unset COST_HOST is a no-op.
func costEvent(algorithmID, runID string, service costService, operation costOperation, quantity float64) {
	if costHost == "" || runID == "" {
		return
	}

	body, err := json.Marshal(struct {
		AlgorithmId string        `json:"algorithmId"`
		RunId       string        `json:"runId"`
		EventId     string        `json:"eventId"`
		Phase       costPhase     `json:"phase"`
		Service     costService   `json:"service"`
		Operation   costOperation `json:"operation"`
		Quantity    float64       `json:"quantity"`
		Timestamp   string        `json:"timestamp"`
	}{algorithmID, runID, uuid.NewString(), phaseBuild, service, operation, quantity, time.Now().UTC().Format(time.RFC3339Nano)})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), costEventTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+costHost+"/cost", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("registry-service: cost event %s:%s failed: %v", service, operation, err)
		return
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		log.Printf("registry-service: cost event %s:%s rejected with %s", service, operation, resp.Status)
	}
	resp.Body.Close()
}
