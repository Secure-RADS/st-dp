package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
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

// Standard Nitro Enclave init cmdline - matches what nitro-cli itself passes
// to the linuxkit-based init ramdisk (aws-nitro-enclaves-cli's blobs are
// built expecting exactly this).
const eifCmdline = "reboot=k panic=30 pci=off nomodules console=ttyS0 i8042.noaux i8042.nomux i8042.nopnp i8042.dumbkbd"

// buildEIF turns the composed rootfs into a Nitro Enclave image file via
// eif_build directly (no docker involved - eif_build only needs a kernel,
// an init/NSM ramdisk, and the app rootfs as a second ramdisk). Measurements
// print as JSON to stdout, not a file - there's no --pcrs_output flag.
func buildEIF(ctx context.Context, rootfsDir, workDir string) (eifPath string, pcrs pcrMeasurements, err error) {
	appRamdisk := filepath.Join(workDir, "app.cpio")
	if err := buildCPIO(ctx, rootfsDir, appRamdisk); err != nil {
		return "", pcrMeasurements{}, fmt.Errorf("build app ramdisk: %w", err)
	}

	eifPath = filepath.Join(workDir, "out.eif")

	out, err := run(ctx, eifBuildBin,
		"--kernel", eifKernelPath,
		"--kernel_config", eifKernelCfg,
		"--cmdline", eifCmdline,
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

func buildCPIO(ctx context.Context, srcDir, dst string) error {
	_, err := run(ctx, "sh", "-c", fmt.Sprintf("cd %q && find . -print0 | cpio --null -o --format=newc > %q", srcDir, dst))
	return err
}
