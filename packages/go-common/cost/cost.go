package cost

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

type Phase string

const (
	Build     Phase = "build"
	Execution Phase = "execution"
)

type Service string

const (
	S3         Service = "s3"
	DynamoDB   Service = "dynamodb"
	SQS        Service = "sqs"
	EC2        Service = "ec2"
	Lambda     Service = "lambda"
	APIGateway Service = "apigateway"
)

type Operation string

const (
	S3Put                 Operation = "put"
	S3Get                 Operation = "get"
	S3Head                Operation = "head"
	S3List                Operation = "list"
	DynamoDBRead          Operation = "read"
	DynamoDBWrite         Operation = "write"
	DynamoDBReadCapacity  Operation = "read-capacity"
	DynamoDBWriteCapacity Operation = "write-capacity"
	SQSSend               Operation = "send"
	SQSReceive            Operation = "receive"
	SQSDelete             Operation = "delete"
	EC2Instance           Operation = "instance"
	LambdaInvocation      Operation = "invocation"
	LambdaCompute         Operation = "compute"
	APIGatewayRequest     Operation = "request"
)

type Unit string

const (
	Request          Unit = "request"
	Byte             Unit = "byte"
	ReadRequestUnit  Unit = "read-request-unit"
	WriteRequestUnit Unit = "write-request-unit"
	Second           Unit = "second"
	GBSecond         Unit = "gb-second"
)

var operationsByService = map[Service][]Operation{
	S3:         {S3Put, S3Get, S3Head, S3List},
	DynamoDB:   {DynamoDBReadCapacity, DynamoDBWriteCapacity, DynamoDBRead, DynamoDBWrite},
	SQS:        {SQSSend, SQSReceive, SQSDelete},
	EC2:        {EC2Instance},
	Lambda:     {LambdaInvocation, LambdaCompute},
	APIGateway: {APIGatewayRequest},
}

func IsPhase(value string) bool {
	return value == string(Build) || value == string(Execution)
}

func IsService(value string) bool {
	_, ok := operationsByService[Service(value)]
	return ok
}

func IsValidOperation(service Service, operation string) bool {
	for _, candidate := range operationsByService[service] {
		if operation == string(candidate) {
			return true
		}
	}
	return false
}

const requestTimeout = time.Second

type Event struct {
	AlgorithmID string
	RunID       string
	EventID     string
	Phase       Phase
	Service     Service
	Operation   Operation
	Quantity    float64
	Timestamp   time.Time
	Detail      map[string]any
}

type Client struct {
	Host       string
	HTTPClient *http.Client
}

func (c Client) Emit(event Event) {
	if c.Host == "" || event.AlgorithmID == "" || event.RunID == "" || event.Quantity < 0 {
		return
	}

	if event.EventID == "" {
		id, err := uuid()
		if err != nil {
			log.Printf("cost event %s:%s failed: %v", event.Service, event.Operation, err)
			return
		}
		event.EventID = id
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}

	body, err := json.Marshal(struct {
		AlgorithmID string         `json:"algorithmId"`
		RunID       string         `json:"runId"`
		EventID     string         `json:"eventId"`
		Phase       Phase          `json:"phase"`
		Service     Service        `json:"service"`
		Operation   Operation      `json:"operation"`
		Quantity    float64        `json:"quantity"`
		Timestamp   string         `json:"timestamp"`
		Detail      map[string]any `json:"detail,omitempty"`
	}{event.AlgorithmID, event.RunID, event.EventID, event.Phase, event.Service, event.Operation, event.Quantity, event.Timestamp.Format(time.RFC3339Nano), event.Detail})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+strings.TrimRight(c.Host, "/")+"/cost", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("cost event %s:%s failed: %v", event.Service, event.Operation, err)
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		log.Printf("cost event %s:%s rejected with %s", event.Service, event.Operation, resp.Status)
	}
}

func uuid() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", fmt.Errorf("generate cost event id: %w", err)
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16]), nil
}
