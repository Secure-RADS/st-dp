package main

import (
	"fmt"
	"os"
)

func runResult(args []string) error {
	if len(args) != 7 {
		return fmt.Errorf("usage: run-result <status> <instanceId> <resultPath> <outputPath> <loadPath> <runId> <algorithmId>")
	}
	status, instanceID, resultPath, outputPath, loadPath, runID, algorithmID :=
		args[0], args[1], args[2], args[3], args[4], args[5], args[6]

	output := readFile(resultPath)
	if output == "" {
		output = readFile(outputPath)
	}
	payload := map[string]any{
		"runId":       runID,
		"algorithmId": algorithmID,
		"instanceId":  instanceID,
		"status":      "exit:" + status,
		"output":      output,
	}
	if output == "" {
		payload["diag"] = map[string]string{"dockerLoad": readFile(loadPath)}
	}
	return writeJSON(payload)
}

func readFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}
