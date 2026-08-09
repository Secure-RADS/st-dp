package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	eifKernelPath  = "/opt/assets/eif/bzImage"
	eifKernelCfg   = "/opt/assets/eif/bzImage.config"
	eifInitRamdisk = "/opt/assets/eif/nsm.cpio"
	eifBuildBin    = "/opt/assets/eif/eif_build"
)

type pcrMeasurements struct {
	PCR0 string `json:"PCR0"`
	PCR1 string `json:"PCR1"`
	PCR2 string `json:"PCR2"`
}

type eifBuildOutput struct {
	Measurements pcrMeasurements `json:"Measurements"`
}

// buildEIF turns the composed rootfs into a Nitro Enclave image file via
// eif_build directly (no docker involved - eif_build only needs a kernel,
// an init/NSM ramdisk, and the app rootfs as a second ramdisk).
func buildEIF(ctx context.Context, rootfsDir, workDir string) (eifPath string, pcrs pcrMeasurements, err error) {
	appRamdisk := filepath.Join(workDir, "app.cpio")
	if err := buildCPIO(ctx, rootfsDir, appRamdisk); err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("build app ramdisk: %w", err)
	}

	eifPath = filepath.Join(workDir, "out.eif")
	measurementsPath := filepath.Join(workDir, "measurements.json")

	_, err = run(ctx, eifBuildBin,
		"--kernel", eifKernelPath,
		"--kernel_config", eifKernelCfg,
		"--ramdisk", eifInitRamdisk,
		"--ramdisk", appRamdisk,
		"--output", eifPath,
		"--pcrs_output", measurementsPath,
	)
	if err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("eif_build: %w", err)
	}

	raw, err := os.ReadFile(measurementsPath)
	if err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("read measurements: %w", err)
	}

	var out eifBuildOutput
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("parse measurements: %w", err)
	}

	return eifPath, out.Measurements, nil
}

func buildCPIO(ctx context.Context, srcDir, dst string) error {
	_, err := run(ctx, "sh", "-c", fmt.Sprintf("cd %q && find . -print0 | cpio --null -o --format=newc > %q", srcDir, dst))
	return err
}
