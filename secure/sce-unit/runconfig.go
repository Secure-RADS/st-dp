package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// registry-service writes this at build time (see rootfs.go) - it's part of the measured image, not runtime config.
const runConfigPath = "/etc/sce/run-config.json"

// runConfig is baked into the EIF at build time - the enclave has no other way to learn which algorithm it's
// running or how to reach verifier-service, since Nitro Enclaves take no user-data.
type runConfig struct {
	AlgorithmId           string `json:"algorithmId"`
	VerifierHost          string `json:"verifierHost"`
	VerifierPubKeySHA256  string `json:"verifierPubKeySHA256"`
	PdmHost               string `json:"pdmHost"`
	PdmPubKeySHA256       string `json:"pdmPubKeySHA256"`
	LogHost               string `json:"logHost"`
	LogPubKeySHA256       string `json:"logPubKeySHA256"`
	TelemetryHost         string `json:"telemetryHost"`
	TelemetryPubKeySHA256 string `json:"telemetryPubKeySHA256"`
	KmsHost               string `json:"kmsHost"`
	KmsPubKeySHA256       string `json:"kmsPubKeySHA256"`
}

func loadRunConfig() (runConfig, error) {
	data, err := os.ReadFile(runConfigPath)
	if err != nil {
		return runConfig{}, fmt.Errorf("read %s: %w", runConfigPath, err)
	}
	var cfg runConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return runConfig{}, fmt.Errorf("parse run config: %w", err)
	}
	return cfg, nil
}
