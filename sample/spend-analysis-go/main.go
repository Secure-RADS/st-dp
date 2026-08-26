package main

import (
	"bufio"
	"encoding/json"
	"log"
	"math"
	"net"
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

type Request struct {
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

func analyze(req Request) Result {
	byCategory := map[string]float64{}
	var anomalies []Anomaly
	var totalMonthly float64

	for _, rec := range req.Records {
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
		AlgorithmID:            req.AlgorithmID,
		UserCount:              len(req.Records),
		TotalSpendByCategory:   byCategory,
		AvgMonthlySpendPerUser: round2(totalMonthly / float64(len(req.Records))),
		Anomalies:              anomalies,
		AnomalyUserCount:       anomalyUsers,
	}
}

func main() {
	log.SetOutput(os.Stderr)
	log.Println("spend-analysis-go starting")

	socketPath := os.Getenv("SCE_SOCKET_PATH")
	if socketPath == "" {
		socketPath = "/run/sce/dc.sock"
	}
	os.Remove(socketPath)

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	log.Printf("listening on %s", socketPath)

	conn, err := listener.Accept()
	if err != nil {
		log.Fatalf("accept: %v", err)
	}
	defer conn.Close()
	log.Println("sce-unit connected")

	reader := bufio.NewReaderSize(conn, 1<<20)
	line, err := reader.ReadBytes('\n')
	if err != nil && len(line) == 0 {
		log.Fatalf("read: %v", err)
	}

	var req Request
	if err := json.Unmarshal(line, &req); err != nil {
		log.Fatalf("parse: %v", err)
	}
	log.Printf("received %d records", len(req.Records))

	out, err := json.Marshal(analyze(req))
	if err != nil {
		log.Fatalf("marshal: %v", err)
	}
	if _, err := conn.Write(append(out, '\n')); err != nil {
		log.Fatalf("write: %v", err)
	}
	log.Println("result sent")
}
