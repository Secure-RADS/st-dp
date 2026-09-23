package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

const logEventTimeout = 5 * time.Second

// runEvent is the constrained set of build-phase timeline events registry-service emits - keep in sync with
// log-service's RUN_EVENTS (the ingest authority rejects anything else). The runId here is the build id.
type runEvent string

const (
	eventBuildStarted      runEvent = "build-started"
	eventEifBuilt          runEvent = "eif-built"
	eventPcrsRegistered    runEvent = "pcrs-registered"
	eventKmsKeyProvisioned runEvent = "kms-key-provisioned"
	eventBuildCompleted    runEvent = "build-completed"
	eventBuildFailed       runEvent = "build-failed"
)

// logEvent fire-and-forgets one timeline event onto the log queue. Best-effort: a logging failure must never
// fail a build, so errors are only logged.
func logEvent(algorithmId, buildId string, event runEvent, detail map[string]any) {
	if logQueueURL == "" {
		return
	}

	body, err := json.Marshal(struct {
		Type        string         `json:"type"`
		AlgorithmId string         `json:"algorithmId"`
		RunId       string         `json:"runId"`
		Event       runEvent       `json:"event"`
		Timestamp   string         `json:"timestamp"`
		Detail      map[string]any `json:"detail,omitempty"`
	}{"run-event", algorithmId, buildId, event, time.Now().UTC().Format(time.RFC3339Nano), detail})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), logEventTimeout)
	defer cancel()
	if _, err := sqsClient.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(logQueueURL),
		MessageBody: aws.String(string(body)),
	}); err != nil {
		log.Printf("registry-service: log event %q failed: %v", event, err)
	}
}
