package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

//go:embed nsjail.cfg.tmpl
var nsjailCfgTmpl string

// Pre-built assets baked into this image's own build (see Dockerfile) -
// never rebuilt per upload. nsjailRuntimeDir is the *entire* exported
// rootfs of the prebuilt nsjail image (github.com/prdai/nsjail-docker):
// nsjail's binary plus every runtime lib it's dynamically linked against -
// copying files individually risks missing a transitive dependency, so the
// whole known-good rootfs is used as-is.
const (
	nsjailRuntimeDir  = "/opt/assets/nsjail-runtime"
	sceUnitBin        = "/opt/assets/sce-unit"
	sceUnitTargetPath = "/usr/local/bin/sce"
)

type ociConfig struct {
	Process struct {
		Args []string `json:"args"`
		Env  []string `json:"env"`
	} `json:"process"`
}

// readOCIConfig reads the OCI runtime bundle's config.json - umoci has
// already done the ENTRYPOINT+CMD concatenation for us, in Process.Args, no
// need to redo that ourselves.
func readOCIConfig(bundleDir string) (ociConfig, error) {
	raw, err := os.ReadFile(filepath.Join(bundleDir, "config.json"))
	if err != nil {
		return ociConfig{}, err
	}

	var cfg ociConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return ociConfig{}, fmt.Errorf("parse bundle config: %w", err)
	}
	return cfg, nil
}

// pathFromEnv pulls PATH out of an OCI image's own declared env. Using the
// image's own PATH (rather than a guessed list of directories) is what
// actually makes this correct across distros - e.g. Alpine keeps /bin,
// /sbin, /usr/bin, /usr/sbin as genuinely separate directories, while
// Debian/Ubuntu/Fedora symlink /bin and /sbin into /usr - the image itself
// already knows which of those a given binary actually lives under. No
// fallback if it's missing - nearly every base image sets one, and
// guessing here would silently paper over an unusual image instead of
// surfacing it.
func pathFromEnv(env []string) (string, error) {
	for _, e := range env {
		if v, ok := strings.CutPrefix(e, "PATH="); ok {
			return v, nil
		}
	}
	return "", fmt.Errorf("image does not declare a PATH env var - required")
}

// resolveExecPath finds the absolute in-jail path for entry. nsjail execve()s
// the binary directly - no shell, no PATH lookup - so a bare command name
// like "python3" (valid for a Docker ENTRYPOINT, which the container runtime
// resolves via PATH) has to be turned into an absolute path before nsjail
// can run it. Erroring here at build time is important: an unresolved entry
// would otherwise produce a jail config that's guaranteed to fail at
// container start, with the real cause (bad DC image layout) disconnected
// from where nsjail actually reports the failure.
//
// Uses Lstat, not Stat: many real images (e.g. uv-managed Python venvs)
// have absolute symlinks like /app/.venv/bin/python3 -> /usr/local/bin/
// python3. Stat follows that against the real host filesystem (this code
// runs unrooted, before nsjail's own chroot-equivalent bind mount exists),
// not scoped to rootfsDir - so it silently fails here even though the
// exact same symlink resolves correctly once nsjail actually roots the
// jail at runtime. Lstat only checks that something exists at the path
// itself, without following it, which is all this needs to know.
func resolveExecPath(rootfsDir, entry, path string) (string, error) {
	if strings.HasPrefix(entry, "/") {
		return entry, nil
	}

	for _, dir := range strings.Split(path, ":") {
		candidate := filepath.Join(dir, entry)
		if info, err := os.Lstat(filepath.Join(rootfsDir, candidate)); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("could not resolve entrypoint %q to an absolute path on PATH=%q", entry, path)
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, out)
	}
	return string(out), nil
}

func copyTree(src, dst string) error {
	_, err := run(context.Background(), "cp", "-a", src, dst)
	return err
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

// composeFinalRootfs replaces the bundle's rootfs (currently just the DC's
// unpacked image) with the actual final layout: nsjail's full runtime as
// the base, the DC's own rootfs nested under opt/dc-app/rootfs, plus
// the SCE Unit binary and a generated nsjail.cfg. umoci's repack diffs
// whatever's on disk at bundle/rootfs against its own bookkeeping - it
// doesn't care that this wholesale swap didn't come from its own unpack.
func composeFinalRootfs(bundleDir, execPath, pathEnv string, execArgs []string) error {
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
	// dcRootfs and tmpFinal both live under the same MkdirTemp root
	// (composeFinalRootfs's caller), so this rename never crosses a
	// filesystem boundary.
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

	if err := os.RemoveAll(dcRootfs); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(tmpFinal, dcRootfs)
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

	workDir, err := os.MkdirTemp("", "registry-build-*")
	if err != nil {
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

	builtTag := strings.ReplaceAll(strings.TrimSuffix(filepath.Base(tarPath), filepath.Ext(tarPath)), ":", "-") + "-built"
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
