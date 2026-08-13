package main

import (
	_ "embed"
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
	sceTLSDir        = "/opt/assets/sce-tls"
)

// composeFinalRootfs replaces the bundle's rootfs with nsjail's runtime as the base, the DC's own rootfs nested under opt/dc-app/rootfs, the SCE Unit binary, and a generated nsjail.cfg.
func composeFinalRootfs(bundleDir, algorithmId, execPath, pathEnv string, execArgs []string) error {
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

	cfgDir := filepath.Join(tmpFinal, "etc", "sce")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		return err
	}
	if err := writeNsjailCfg(filepath.Join(cfgDir, "nsjail.cfg"), execPath, pathEnv, execArgs); err != nil {
		return err
	}
	if err := writeSceTrustMaterial(cfgDir); err != nil {
		return fmt.Errorf("write sce trust material: %w", err)
	}
	if err := os.WriteFile(filepath.Join(cfgDir, "algorithm-id"), []byte(algorithmId), 0o644); err != nil {
		return fmt.Errorf("write algorithm id: %w", err)
	}

	if err := os.RemoveAll(dcRootfs); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(tmpFinal, dcRootfs)
}

// writeSceTrustMaterial bakes sce-unit's own mTLS client cert/key and its
// pinned verifier-service config into the composed rootfs (etc/sce/), same
// trust-material-baked-at-build-time convention as registry-service's own
// tls/client.crt (verifier.go) - this is what sce-unit reads at enclave
// runtime to attest to verifier-service (see sce-unit/attest.go).
func writeSceTrustMaterial(cfgDir string) error {
	tlsDir := filepath.Join(cfgDir, "tls")
	if err := os.MkdirAll(tlsDir, 0o755); err != nil {
		return err
	}
	if err := copyFile(filepath.Join(sceTLSDir, "client.crt"), filepath.Join(tlsDir, "client.crt"), 0o644); err != nil {
		return fmt.Errorf("copy sce client cert: %w", err)
	}
	if err := copyFile(filepath.Join(sceTLSDir, "client.key"), filepath.Join(tlsDir, "client.key"), 0o600); err != nil {
		return fmt.Errorf("copy sce client key: %w", err)
	}

	attestURL := os.Getenv("VERIFIER_ATTEST_URL")
	pinnedPubKey := os.Getenv("VERIFIER_PUBKEY_SHA256")
	if attestURL == "" || pinnedPubKey == "" {
		return fmt.Errorf("VERIFIER_ATTEST_URL / VERIFIER_PUBKEY_SHA256 not configured")
	}
	if err := os.WriteFile(filepath.Join(cfgDir, "verifier-attest-url"), []byte(attestURL), 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(cfgDir, "verifier-pubkey.sha256"), []byte(pinnedPubKey), 0o644)
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
