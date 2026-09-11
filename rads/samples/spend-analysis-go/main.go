package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
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

type Page struct {
	AlgorithmID string   `json:"algorithmId"`
	Records     []Record `json:"records"`
	NextCursor  *string  `json:"nextCursor"`
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

func fetchAll(client *http.Client, pdmURL, algorithmID string) ([]Record, error) {
	var records []Record
	cursor := ""
	for {
		u, err := url.Parse(pdmURL)
		if err != nil {
			return nil, fmt.Errorf("parse PDM_URL: %w", err)
		}
		u.Path = "/records"
		q := u.Query()
		q.Set("algorithmId", algorithmID)
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		u.RawQuery = q.Encode()

		resp, err := client.Get(u.String())
		if err != nil {
			return nil, fmt.Errorf("GET %s: %w", u.String(), err)
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("PDM returned HTTP %d for %s", resp.StatusCode, u.String())
		}

		var page Page
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, fmt.Errorf("parse page: %w", err)
		}
		records = append(records, page.Records...)
		log.Printf("page: fetched %d records, cumulative %d", len(page.Records), len(records))
		if page.NextCursor == nil || *page.NextCursor == "" {
			break
		}
		cursor = *page.NextCursor
	}
	return records, nil
}

func main() {
	log.SetOutput(os.Stderr)
	pdmURL := os.Getenv("PDM_URL")
	algorithmID := os.Getenv("ALGORITHM_ID")
	if pdmURL == "" || algorithmID == "" {
		log.Fatal("PDM_URL and ALGORITHM_ID are required")
	}

	records, err := fetchAll(&http.Client{}, pdmURL, algorithmID)
	if err != nil {
		log.Fatalf("fetch: %v", err)
	}
	log.Printf("received %d records", len(records))

	out, err := json.Marshal(analyze(algorithmID, records))
	if err != nil {
		log.Fatalf("marshal: %v", err)
	}
	fmt.Println(string(out))
}