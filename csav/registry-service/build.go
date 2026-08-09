package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"
)

// buildAndPush unpacks the uploaded OCI image, jails the Data Controller's
// app behind nsjail (with the SCE Unit as the composed image's real
// entrypoint), builds a Nitro Enclave EIF from the result, and uploads that
// straight to S3. The raw upload and the intermediate OCI bundle never get
// persisted - only the EIF does.
//
// Unpack goes through skopeo + umoci rather than a daemon: no docker.sock,
// no buildah-style unshare/capabilities either - umoci's rootless unpack
// needs nothing beyond normal filesystem access. The EIF build itself
// (eif.go) avoids docker too, via eif_build directly on the composed rootfs.
func buildAndPush(ctx context.Context, algorithmId, tarPath string) (string, error) {
	start := time.Now()
	log.Printf("build[%s]: start", tarPath)

	workDir := filepath.Join(os.TempDir(), "registry-build-"+algorithmId)
	if err := os.Mkdir(workDir, 0o755); err != nil {
		return "", err
	}
	defer os.RemoveAll(workDir)

	layoutDir := filepath.Join(workDir, "layout")
	bundleDir := filepath.Join(workDir, "bundle")

	log.Printf("build[%s]: skopeo copy in", tarPath)
	if _, err := run(ctx, "skopeo", "copy", "docker-archive:"+tarPath, "oci:"+layoutDir+":src"); err != nil {
		return "", fmt.Errorf("skopeo copy in: %w", err)
	}

	log.Printf("build[%s]: umoci unpack", tarPath)
	if _, err := run(ctx, "umoci", "unpack", "--rootless", "--image", layoutDir+":src", bundleDir); err != nil {
		return "", fmt.Errorf("umoci unpack: %w", err)
	}

	cfg, err := readOCIConfig(bundleDir)
	if err != nil {
		return "", err
	}
	if len(cfg.Process.Args) == 0 {
		return "", fmt.Errorf("image has no entrypoint/cmd - nothing to jail")
	}
	execPath, args := cfg.Process.Args[0], cfg.Process.Args[1:]

	pathEnv, err := pathFromEnv(cfg.Process.Env)
	if err != nil {
		return "", err
	}

	dcRootfs := filepath.Join(bundleDir, "rootfs")
	execPath, err = resolveExecPath(dcRootfs, execPath, pathEnv)
	if err != nil {
		return "", err
	}
	log.Printf("build[%s]: resolved entrypoint %s %v", tarPath, execPath, args)

	log.Printf("build[%s]: composing final rootfs", tarPath)
	if err := composeFinalRootfs(bundleDir, execPath, pathEnv, args); err != nil {
		return "", fmt.Errorf("compose final rootfs: %w", err)
	}

	log.Printf("build[%s]: building EIF", tarPath)
	eifPath, pcrs, err := buildEIF(ctx, dcRootfs, workDir)
	if err != nil {
		return "", fmt.Errorf("build EIF: %w", err)
	}

	f, err := os.Open(eifPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	key := algorithmId + ".eif"
	log.Printf("build[%s]: uploading to s3 key=%s", tarPath, key)
	if err := uploadToS3(ctx, key, f); err != nil {
		return "", fmt.Errorf("upload EIF: %w", err)
	}

	log.Printf("build[%s]: registering PCRs with verifier-service", tarPath)
	if err := registerPCRs(ctx, algorithmId, pcrs); err != nil {
		return "", fmt.Errorf("register PCRs: %w", err)
	}

	log.Printf("build[%s]: done key=%s took=%s", tarPath, key, time.Since(start))
	return key, nil
}
