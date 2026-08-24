package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	eifKernelPath  = "/opt/assets/eif/Image"
	eifKernelCfg   = "/opt/assets/eif/Image.config"
	eifInitRamdisk = "/opt/assets/eif/bootstrap.cpio"
	eifCmdlinePath = "/opt/assets/eif/cmdline"
	eifBuildBin    = "/opt/assets/eif/eif_build"
)

type pcrMeasurements struct {
	PCR0 string `json:"PCR0"`
	PCR1 string `json:"PCR1"`
	PCR2 string `json:"PCR2"`
}

// AWS's own init binary (which we can't modify) requires /rootfs, /cmd (argv to exec after
// pivoting into /rootfs), and /env (fopen'd unconditionally; missing it crashes musl's fclose(NULL)).
const sceEntrypoint = "/usr/local/bin/sce"

// buildEIF measurements come as JSON on stdout - eif_build has no --pcrs_output flag.
func buildEIF(ctx context.Context, rootfsDir, workDir string) (eifPath string, pcrs pcrMeasurements, err error) {
	appStagingDir := filepath.Join(workDir, "app-ramdisk")
	if err := stageAppRamdisk(rootfsDir, appStagingDir); err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("stage app ramdisk: %w", err)
	}

	appRamdisk := filepath.Join(workDir, "app.cpio")
	if err := buildCPIO(ctx, appStagingDir, appRamdisk); err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("build app ramdisk: %w", err)
	}

	eifPath = filepath.Join(workDir, "out.eif")

	cmdlineBytes, err := os.ReadFile(eifCmdlinePath)
	if err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("read cmdline blob: %w", err)
	}

	out, err := run(ctx, eifBuildBin,
		"--kernel", eifKernelPath,
		"--kernel_config", eifKernelCfg,
		"--cmdline", strings.TrimSpace(string(cmdlineBytes)),
		"--ramdisk", eifInitRamdisk,
		"--ramdisk", appRamdisk,
		"--output", eifPath,
		"--arch", "aarch64",
	)
	if err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("eif_build: %w", err)
	}

	jsonStart := strings.Index(out, "{")
	if jsonStart < 0 {
		return "", pcrMeasurements{}, fmt.Errorf("eif_build: no measurements JSON in output: %s", out)
	}

	var result pcrMeasurements
	if err := json.Unmarshal([]byte(out[jsonStart:]), &result); err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("parse measurements: %w", err)
	}

	return eifPath, result, nil
}

func stageAppRamdisk(rootfsDir, stagingDir string) error {
	stagedRootfs := filepath.Join(stagingDir, "rootfs")
	if err := os.MkdirAll(filepath.Dir(stagedRootfs), 0o755); err != nil {
		return err
	}
	if err := copyTree(rootfsDir, stagedRootfs); err != nil {
		return fmt.Errorf("copy rootfs into staging: %w", err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir, "env"), nil, 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(stagingDir, "cmd"), []byte(sceEntrypoint+"\n"), 0o644)
}

func buildCPIO(ctx context.Context, srcDir, dst string) error {
	_, err := run(ctx, "sh", "-c", fmt.Sprintf("cd %q && find . -print0 | cpio --null -o --format=newc > %q", srcDir, dst))
	return err
}
