package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"sort"
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

type RecordsFile struct {
	AlgorithmID string   `json:"algorithmId"`
	Records     []Record `json:"records"`
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

func loadRecords(path string) (string, []Record, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return "", nil, fmt.Errorf("read %s: %w", path, err)
	}
	var file RecordsFile
	if err := json.Unmarshal(body, &file); err != nil {
		return "", nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return file.AlgorithmID, file.Records, nil
}

func writeResult(result Result) error {
	out, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal result: %w", err)
	}
	if path := os.Getenv("RESULT_PATH"); path != "" {
		return os.WriteFile(path, out, 0o644)
	}
	fmt.Println(string(out))
	return nil
}

func main() {
	log.SetOutput(os.Stderr)
	recordsPath := os.Getenv("RECORDS_PATH")
	if recordsPath == "" {
		log.Fatal("RECORDS_PATH is required")
	}

	algorithmID, records, err := loadRecords(recordsPath)
	if err != nil {
		log.Fatalf("load: %v", err)
	}
	log.Printf("loaded %d records from %s", len(records), recordsPath)

	if err := writeResult(analyze(algorithmID, records)); err != nil {
		log.Fatalf("write result: %v", err)
	}
}