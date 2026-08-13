package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// buildAndPush unpacks the uploaded OCI image, jails the Data Controller's
// app behind nsjail (with the SCE Unit as the composed image's real
// entrypoint), and streams the result straight to S3. The raw upload never
// gets persisted - only this composed output does.
//
// Everything goes through skopeo + umoci rather than a daemon: no
// docker.sock, no buildah-style unshare/capabilities either - umoci's
// rootless unpack/repack needs nothing beyond normal filesystem access,
// because there's no Dockerfile-style RUN step in this pipeline at all,
// just file composition (copy nsjail + sce-unit + the DC's own rootfs into
// place, no arbitrary commands to sandbox a build for).
func buildAndPush(ctx context.Context, tarPath string) (string, error) {
	start := time.Now()
	log.Printf("build[%s]: start", tarPath)

	id := strings.TrimSuffix(filepath.Base(tarPath), filepath.Ext(tarPath))
	workDir := filepath.Join(os.TempDir(), "registry-build-"+id)
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

	log.Printf("build[%s]: umoci repack", tarPath)
	if _, err := run(ctx, "umoci", "repack", "--image", layoutDir+":built", bundleDir); err != nil {
		return "", fmt.Errorf("umoci repack: %w", err)
	}

	if _, err := run(ctx, "umoci", "config", "--image", layoutDir+":built", "--config.entrypoint", sceUnitTargetPath); err != nil {
		return "", fmt.Errorf("umoci config: %w", err)
	}

	builtTag := id + "-built"
	outTar := filepath.Join(workDir, "out.tar")
	log.Printf("build[%s]: skopeo copy out", tarPath)
	if _, err := run(ctx, "skopeo", "copy", "oci:"+layoutDir+":built", "docker-archive:"+outTar); err != nil {
		return "", fmt.Errorf("skopeo copy out: %w", err)
	}

	f, err := os.Open(outTar)
	if err != nil {
		return "", err
	}
	defer f.Close()

	key := builtTag + ".tar"
	log.Printf("build[%s]: uploading to s3 key=%s", tarPath, key)
	if err := uploadToS3(ctx, key, f); err != nil {
		return "", fmt.Errorf("upload built image: %w", err)
	}

	log.Printf("build[%s]: done key=%s took=%s", tarPath, key, time.Since(start))
	return key, nil
}
