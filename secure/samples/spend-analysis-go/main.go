package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"os"
	"sort"

	scev1 "spend-analysis/gen/scev1"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

type Transaction struct {
	Ts       string  `json:"ts"`
	Amount   float64 `json:"amount"`
	Category string  `json:"category"`
	Merchant string  `json:"merchant"`
}

type Data struct {
	Age          int           `json:"age"`
	AccountType  string        `json:"accountType"`
	Transactions []Transaction `json:"transactions"`
}

type Record struct {
	RecordID string `json:"recordId"`
	Data     Data   `json:"data"`
}

type Anomaly struct {
	RecordID string `json:"recordId"`
	Count    int    `json:"count"`
}

type Result struct {
	AlgorithmID            string             `json:"algorithmId"`
	UserCount              int                `json:"userCount"`
	TotalSpendByCategory   map[string]float64 `json:"totalSpendByCategory"`
	AvgMonthlySpendPerUser float64            `json:"avgMonthlySpendPerUser"`
	Anomalies              []Anomaly          `json:"anomalies"`
	AnomalyUserCount       int                `json:"anomalyUserCount"`
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func analyze(algorithmID string, records []Record) Result {
	byCategory := map[string]float64{}
	var anomalies []Anomaly
	var totalMonthly float64

	for _, rec := range records {
		txs := rec.Data.Transactions
		var absSum, spend float64
		months := map[string]bool{}
		for _, tx := range txs {
			absSum += math.Abs(tx.Amount)
			if tx.Amount < 0 {
				spend += -tx.Amount
				byCategory[tx.Category] += -tx.Amount
			}
			if len(tx.Ts) >= 7 {
				months[tx.Ts[:7]] = true
			}
		}
		if len(months) > 0 {
			totalMonthly += spend / float64(len(months))
		}
		if len(txs) == 0 {
			continue
		}
		mean := absSum / float64(len(txs))
		count := 0
		for _, tx := range txs {
			if math.Abs(tx.Amount) > 3*mean {
				count++
			}
		}
		if count >= 1 {
			anomalies = append(anomalies, Anomaly{RecordID: rec.RecordID, Count: count})
		}
	}

	for k, v := range byCategory {
		byCategory[k] = round2(v)
	}
	anomalyUsers := len(anomalies)
	sort.Slice(anomalies, func(i, j int) bool { return anomalies[i].RecordID < anomalies[j].RecordID })
	if len(anomalies) > 50 {
		anomalies = anomalies[:50]
	}
	if anomalies == nil {
		anomalies = []Anomaly{}
	}

	return Result{
		AlgorithmID:            algorithmID,
		UserCount:              len(records),
		TotalSpendByCategory:   byCategory,
		AvgMonthlySpendPerUser: round2(totalMonthly / float64(len(records))),
		Anomalies:              anomalies,
		AnomalyUserCount:       anomalyUsers,
	}
}

func fetchRecords(ctx context.Context, client scev1.DataAccessClient) ([]Record, error) {
	stream, err := client.FetchRecords(ctx, &scev1.FetchRecordsRequest{})
	if err != nil {
		return nil, fmt.Errorf("fetch records: %w", err)
	}

	var records []Record
	for {
		message, err := stream.Recv()
		if err == io.EOF {
			return records, nil
		}
		if err != nil {
			return nil, fmt.Errorf("receive record: %w", err)
		}
		raw, err := protojson.Marshal(message.GetData())
		if err != nil {
			return nil, fmt.Errorf("encode record %s: %w", message.GetRecordId(), err)
		}
		var data Data
		if err := json.Unmarshal(raw, &data); err != nil {
			return nil, fmt.Errorf("decode record %s: %w", message.GetRecordId(), err)
		}
		records = append(records, Record{RecordID: message.GetRecordId(), Data: data})
	}
}

func submitResult(ctx context.Context, client scev1.DataAccessClient, result Result) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal result: %w", err)
	}
	payload := &structpb.Struct{}
	if err := protojson.Unmarshal(raw, payload); err != nil {
		return fmt.Errorf("encode result: %w", err)
	}
	if _, err := client.SubmitResult(ctx, &scev1.SubmitResultRequest{Result: payload}); err != nil {
		return fmt.Errorf("submit result: %w", err)
	}
	return nil
}

func main() {
	log.SetOutput(os.Stderr)
	socketPath := os.Getenv("SCE_RPC_SOCKET")
	if socketPath == "" {
		log.Fatal("SCE_RPC_SOCKET is required")
	}
	algorithmID := os.Getenv("ALGORITHM_ID")
	if algorithmID == "" {
		log.Fatal("ALGORITHM_ID is required")
	}

	conn, err := grpc.NewClient(
		"passthrough:///sce-unit",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
		}),
	)
	if err != nil {
		log.Fatalf("dial %s: %v", socketPath, err)
	}
	defer conn.Close()

	ctx := context.Background()
	client := scev1.NewDataAccessClient(conn)
	records, err := fetchRecords(ctx, client)
	if err != nil {
		log.Fatalf("load: %v", err)
	}
	log.Printf("loaded %d records over %s", len(records), socketPath)

	if err := submitResult(ctx, client, analyze(algorithmID, records)); err != nil {
		log.Fatalf("result: %v", err)
	}
}
