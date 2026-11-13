package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"text/template"
)

//go:embed nsjail.cfg.tmpl
var nsjailCfgTmpl string

// Pre-built assets baked into this image's own build (see Dockerfile) - never rebuilt per upload.
const (
	nsjailRuntimeDir = "/opt/assets/nsjail-runtime"
	sceUnitBin       = "/opt/assets/sce-unit"
	caCertBundle     = "/opt/assets/ca-certificates.crt"
)

// runConfig is baked into /etc/sce/run-config.json (see sce-unit/attest.go) and is part of the measured PCRs, so changing verifierHost or the pinned pubkey means rebuilding and re-registering the EIF.
type runConfig struct {
	AlgorithmId          string `json:"algorithmId"`
	VerifierHost         string `json:"verifierHost"`
	VerifierPubKeySHA256 string `json:"verifierPubKeySHA256"`
	PdmHost              string `json:"pdmHost"`
	PdmPubKeySHA256      string `json:"pdmPubKeySHA256"`
	LogHost              string `json:"logHost"`
	LogPubKeySHA256      string `json:"logPubKeySHA256"`
	Region               string `json:"region"`
}

// composeFinalRootfs replaces the bundle's rootfs with nsjail's runtime as the base, the DC's own rootfs nested under opt/dc-app/rootfs, the SCE Unit binary, and a generated nsjail.cfg.
func composeFinalRootfs(bundleDir, execPath, pathEnv string, execArgs []string, cfg runConfig) error {
	dcRootfs := filepath.Join(bundleDir, "rootfs")
	tmpFinal := bundleDir + "-final-rootfs"
	defer os.RemoveAll(tmpFinal)

	if err := copyTree(nsjailRuntimeDir, tmpFinal); err != nil {
		return fmt.Errorf("copy nsjail runtime: %w", err)
	}

	dcAppRootfs := filepath.Join(tmpFinal, "opt", "dc-app", "rootfs")
	if err := os.MkdirAll(filepath.Dir(dcAppRootfs), 0o755); err != nil {
		return err
	}
	if err := os.Rename(dcRootfs, dcAppRootfs); err != nil {
		return fmt.Errorf("place DC rootfs: %w", err)
	}

	sceDir := filepath.Join(tmpFinal, "usr", "local", "bin")
	if err := os.MkdirAll(sceDir, 0o755); err != nil {
		return err
	}
	if err := copyFile(sceUnitBin, filepath.Join(sceDir, "sce"), 0o755); err != nil {
		return fmt.Errorf("copy sce-unit: %w", err)
	}
	certDir := filepath.Join(tmpFinal, "etc", "ssl", "certs")
	if err := os.MkdirAll(certDir, 0o755); err != nil {
		return err
	}
	if err := copyFile(caCertBundle, filepath.Join(certDir, "ca-certificates.crt"), 0o644); err != nil {
		return fmt.Errorf("copy CA certificate bundle: %w", err)
	}

	cfgDir := filepath.Join(tmpFinal, "etc", "sce")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		return err
	}
	if err := writeNsjailCfg(filepath.Join(cfgDir, "nsjail.cfg"), execPath, pathEnv, execArgs); err != nil {
		return err
	}
	if err := writeRunConfig(filepath.Join(cfgDir, "run-config.json"), cfg); err != nil {
		return err
	}

	if err := os.RemoveAll(dcRootfs); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(tmpFinal, dcRootfs)
}

func writeNsjailCfg(path, execPath, pathEnv string, args []string) error {
	tmpl, err := template.New("nsjail.cfg").Parse(nsjailCfgTmpl)
	if err != nil {
		return err
	}

	out, err := os.Create(path)
	if err != nil {
		return err
	}
	defer out.Close()

	return tmpl.Execute(out, struct {
		Path    string
		PathEnv string
		Args    []string
	}{Path: execPath, PathEnv: pathEnv, Args: args})
}

func writeRunConfig(path string, cfg runConfig) error {
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
