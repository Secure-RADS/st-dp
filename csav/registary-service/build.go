package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

//go:embed nsjail.cfg.tmpl
var nsjailCfgTmpl string

// Pre-built assets baked into this image's own build (see Dockerfile) -
// never rebuilt per upload. nsjailRuntimeDir is nsjail-base's *entire*
// exported rootfs (nsjail's binary plus every runtime lib it's dynamically
// linked against - copying files individually risks missing a transitive
// dependency, so the whole known-good rootfs is used as-is).
const (
	nsjailRuntimeDir = "/opt/assets/nsjail-runtime"
	sceUnitBin       = "/opt/assets/sce-unit"
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
	workDir, err := os.MkdirTemp("", "registry-build-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(workDir)

	layoutDir := filepath.Join(workDir, "layout")
	bundleDir := filepath.Join(workDir, "bundle")

	if _, err := run(ctx, "skopeo", "copy", "docker-archive:"+tarPath, "oci:"+layoutDir+":src"); err != nil {
		return "", fmt.Errorf("skopeo copy in: %w", err)
	}

	if _, err := run(ctx, "umoci", "unpack", "--rootless", "--image", layoutDir+":src", bundleDir); err != nil {
		return "", fmt.Errorf("umoci unpack: %w", err)
	}

	execPath, args, err := readEntrypoint(bundleDir)
	if err != nil {
		return "", err
	}

	dcRootfs := filepath.Join(bundleDir, "rootfs")
	execPath = resolveExecPath(dcRootfs, execPath, readEnv(bundleDir))

	if err := composeFinalRootfs(bundleDir, execPath, args); err != nil {
		return "", fmt.Errorf("compose final rootfs: %w", err)
	}

	if _, err := run(ctx, "umoci", "repack", "--image", layoutDir+":built", bundleDir); err != nil {
		return "", fmt.Errorf("umoci repack: %w", err)
	}

	if _, err := run(ctx, "umoci", "config", "--image", layoutDir+":built", "--config.entrypoint", sceUnitTargetPath); err != nil {
		return "", fmt.Errorf("umoci config: %w", err)
	}

	builtTag := strings.ReplaceAll(strings.TrimSuffix(filepath.Base(tarPath), filepath.Ext(tarPath)), ":", "-") + "-built"
	outTar := filepath.Join(workDir, "out.tar")
	if _, err := run(ctx, "skopeo", "copy", "oci:"+layoutDir+":built", "docker-archive:"+outTar); err != nil {
		return "", fmt.Errorf("skopeo copy out: %w", err)
	}

	f, err := os.Open(outTar)
	if err != nil {
		return "", err
	}
	defer f.Close()

	key := builtTag + ".tar"
	if err := uploadToS3(ctx, key, f); err != nil {
		return "", fmt.Errorf("upload built image: %w", err)
	}

	return key, nil
}

const sceUnitTargetPath = "/usr/local/bin/sce"

type ociConfig struct {
	Process struct {
		Args []string `json:"args"`
		Env  []string `json:"env"`
	} `json:"process"`
}

// readEntrypoint reads the resolved exec array straight from the OCI
// runtime bundle umoci already produced - it has already done the
// ENTRYPOINT+CMD concatenation for us, no need to redo that ourselves.
func readEntrypoint(bundleDir string) (path string, args []string, err error) {
	raw, err := os.ReadFile(filepath.Join(bundleDir, "config.json"))
	if err != nil {
		return "", nil, err
	}

	var cfg ociConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return "", nil, fmt.Errorf("parse bundle config: %w", err)
	}
	if len(cfg.Process.Args) == 0 {
		return "", nil, fmt.Errorf("image has no entrypoint/cmd - nothing to jail")
	}
	return cfg.Process.Args[0], cfg.Process.Args[1:], nil
}

func readEnv(bundleDir string) []string {
	raw, err := os.ReadFile(filepath.Join(bundleDir, "config.json"))
	if err != nil {
		return nil
	}
	var cfg ociConfig
	json.Unmarshal(raw, &cfg)
	return cfg.Process.Env
}

// resolveExecPath finds the absolute in-jail path for entry. nsjail execve()s
// the binary directly - no shell, no PATH lookup - so a bare command name
// like "python3" (valid for a Docker ENTRYPOINT, which the container runtime
// resolves via PATH) has to be turned into an absolute path before nsjail
// can run it.
func resolveExecPath(rootfsDir, entry string, env []string) string {
	if strings.HasPrefix(entry, "/") {
		return entry
	}

	path := "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
	for _, e := range env {
		if v, ok := strings.CutPrefix(e, "PATH="); ok {
			path = v
			break
		}
	}

	for _, dir := range strings.Split(path, ":") {
		candidate := filepath.Join(dir, entry)
		if info, err := os.Stat(filepath.Join(rootfsDir, candidate)); err == nil && !info.IsDir() {
			return candidate
		}
	}

	return entry
}

// composeFinalRootfs replaces the bundle's rootfs (currently just the DC's
// unpacked image) with the actual final layout: nsjail's full runtime as
// the base, the DC's own rootfs nested under opt/controller/rootfs, plus
// the SCE Unit binary and a generated nsjail.cfg. umoci's repack diffs
// whatever's on disk at bundle/rootfs against its own bookkeeping - it
// doesn't care that this wholesale swap didn't come from its own unpack.
func composeFinalRootfs(bundleDir, execPath string, execArgs []string) error {
	dcRootfs := filepath.Join(bundleDir, "rootfs")
	tmpFinal := bundleDir + "-final-rootfs"
	defer os.RemoveAll(tmpFinal)

	if err := copyTree(nsjailRuntimeDir, tmpFinal); err != nil {
		return fmt.Errorf("copy nsjail runtime: %w", err)
	}

	controllerRootfs := filepath.Join(tmpFinal, "opt", "controller", "rootfs")
	if err := os.MkdirAll(filepath.Dir(controllerRootfs), 0o755); err != nil {
		return err
	}
	if err := os.Rename(dcRootfs, controllerRootfs); err != nil {
		// Rename can fail across filesystem boundaries in some environments;
		// fall back to a copy.
		if err := copyTree(dcRootfs, controllerRootfs); err != nil {
			return fmt.Errorf("place DC rootfs: %w", err)
		}
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
	if err := writeNsjailCfg(filepath.Join(cfgDir, "nsjail.cfg"), execPath, execArgs); err != nil {
		return err
	}

	if err := os.RemoveAll(dcRootfs); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(tmpFinal, dcRootfs)
}

func writeNsjailCfg(path, execPath string, args []string) error {
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
		Path string
		Args []string
	}{Path: execPath, Args: args})
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, out)
	}
	return string(out), nil
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func copyTree(src, dst string) error {
	_, err := run(context.Background(), "cp", "-a", src, dst)
	return err
}

// uploadToS3 streams body via the S3 upload manager (multipart upload)
// rather than PutObject directly, since not every caller has a
// known-length or seekable body.
func uploadToS3(ctx context.Context, key string, body io.Reader) error {
	uploader := manager.NewUploader(s3Client)
	_, err := uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: &artifactBucket,
		Key:    &key,
		Body:   body,
	})
	return err
}
