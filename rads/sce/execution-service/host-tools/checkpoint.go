package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

func checkpoint(args []string) error {
	if len(args) != 3 {
		return fmt.Errorf("usage: checkpoint <algorithmId> <runId> <event>")
	}
	return writeJSON(map[string]any{
		"algorithmId": args[0],
		"runId":       args[1],
		"event":       args[2],
		"timestamp":   time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func executorFinished(args []string) error {
	if len(args) != 4 {
		return fmt.Errorf("usage: executor-finished <status> <instanceId> <algorithmId> <runId>")
	}
	return writeJSON(map[string]any{
		"algorithmId": args[2],
		"runId":       args[3],
		"event":       "executor-finished",
		"timestamp":   time.Now().UTC().Format(time.RFC3339Nano),
		"detail": map[string]string{
			"status":     "exit:" + args[0],
			"instanceId": args[1],
		},
	})
}

func writeJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}
