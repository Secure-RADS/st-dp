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

// The app ramdisk's layout is dictated by AWS's own init binary (aws/aws-nitro-enclaves-sdk-bootstrap,
// init/init.c), which we can't modify - it's baked into the kernel blobs AWS ships. It expects three
// top-level entries:
//   - /rootfs: the actual app filesystem, which init bind-mounts and pivots into via chroot.
//   - /cmd: a newline-separated argv telling init what to exec after the pivot. Without it, init
//     falls back to a plain shell at best, or - if the /rootfs mount itself fails - dies before
//     ever reaching the ready-signal handshake the parent instance is waiting on.
//   - /env: init always fopen()s this, even when we don't intend to supply one, and then
//     fclose()s the result unconditionally. A missing file makes fopen return NULL, and this init
//     is built against musl, where fclose(NULL) crashes (glibc treats it as a harmless no-op).
//     So /env must exist even when empty, purely to dodge that crash.
//
// The kernel boot cmdline has the same "must match this exact init binary" requirement, and also
// varies by CPU architecture. It's read verbatim from the arch-specific blob file rather than
// hardcoded, after a hardcoded x86_64 string was found to be missing aarch64's root=/dev/ram0.
const sceEntrypoint = "/usr/local/bin/sce"

// buildEIF turns the composed rootfs into a Nitro Enclave image file via
// eif_build directly (no docker involved - eif_build only needs a kernel,
// an init/NSM ramdisk, and the app rootfs as a second ramdisk). Measurements
// print as JSON to stdout, not a file - there's no --pcrs_output flag.
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

// stageAppRamdisk wraps the composed rootfs under staging/rootfs and writes
// staging/cmd, matching the init contract described above.
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
