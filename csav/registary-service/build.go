package main

import (
	"bytes"
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

const nsjailBaseImage = "nsjail-base:latest"

// buildAndPush unpacks the uploaded OCI image, jails the Data Controller's
// app behind nsjail, rebuilds a new image with that layout, and streams the
// result straight to S3. The raw upload never gets persisted - only this
// composed output does.
//
// Everything goes through the buildah CLI rather than a Docker daemon:
// buildah runs unprivileged (via `buildah unshare`, a rootless user
// namespace) with no socket to expose, unlike the Docker approach this
// replaced which needed docker.sock mounted into the same process handling
// the public /upload endpoint.
func buildAndPush(ctx context.Context, tarPath string) (string, error) {
	buildDir, err := os.MkdirTemp("", "registry-build-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(buildDir)

	sourceImageID, cfg, err := pullAndInspect(ctx, tarPath)
	if err != nil {
		return "", fmt.Errorf("pull/inspect: %w", err)
	}

	// Docker's own exec model: ENTRYPOINT + CMD concatenated, ENTRYPOINT's
	// tail (e.g. the "/main.py" in ["python3", "/main.py"]) is arguments,
	// not something to discard.
	full := append(append([]string{}, cfg.Entrypoint...), cfg.Cmd...)
	if len(full) == 0 {
		return "", fmt.Errorf("image %s has no ENTRYPOINT or CMD - nothing to jail", sourceImageID)
	}
	entrypoint, args := full[0], full[1:]

	rootfsDir := filepath.Join(buildDir, "opt", "controller", "rootfs")
	if err := os.MkdirAll(rootfsDir, 0o755); err != nil {
		return "", err
	}

	if err := exportRootfs(ctx, sourceImageID, rootfsDir); err != nil {
		return "", fmt.Errorf("export rootfs: %w", err)
	}

	execPath := resolveExecPath(rootfsDir, entrypoint, cfg.Env)
	if err := writeNsjailCfg(buildDir, execPath, args); err != nil {
		return "", err
	}

	if err := writeContainerfile(buildDir); err != nil {
		return "", err
	}

	builtTag := strings.ReplaceAll(strings.TrimSuffix(filepath.Base(tarPath), filepath.Ext(tarPath)), ":", "-") + "-built:latest"
	outTar := filepath.Join(buildDir, "out.tar")
	if err := buildAndSave(ctx, buildDir, builtTag, sourceImageID, outTar); err != nil {
		return "", fmt.Errorf("build image: %w", err)
	}

	f, err := os.Open(outTar)
	if err != nil {
		return "", err
	}
	defer f.Close()

	key := strings.ReplaceAll(builtTag, ":", "-") + ".tar"
	if err := uploadToS3(ctx, key, f); err != nil {
		return "", fmt.Errorf("upload built image: %w", err)
	}

	return key, nil
}

type imageConfig struct {
	Entrypoint []string
	Cmd        []string
	Env        []string
}

// pullAndInspect loads the uploaded tar into buildah's local storage (no
// daemon - this is skopeo/containers-storage under the hood) and returns
// its image ID plus its own declared entrypoint/cmd/env.
func pullAndInspect(ctx context.Context, tarPath string) (string, imageConfig, error) {
	imageID, err := runBuildah(ctx, "pull", "docker-archive:"+tarPath)
	if err != nil {
		return "", imageConfig{}, err
	}
	imageID = strings.TrimSpace(imageID)

	raw, err := runBuildah(ctx, "inspect", "--format", "{{json .OCIv1.Config}}", imageID)
	if err != nil {
		return "", imageConfig{}, err
	}

	var cfg imageConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return "", imageConfig{}, fmt.Errorf("parse image config: %w", err)
	}

	return imageID, cfg, nil
}

// exportRootfs mounts the source image's rootfs (rootless overlay, via
// `buildah unshare`) and copies it out to destDir - `buildah mount`'s
// result only exists within that unshare'd mount namespace, so the mount
// and the copy-out have to happen in the same invocation.
func exportRootfs(ctx context.Context, imageID, destDir string) error {
	script := fmt.Sprintf(`set -e
CID=$(buildah from %s)
MNT=$(buildah mount "$CID")
cp -a "$MNT"/. %s/
buildah umount "$CID" >/dev/null
buildah rm "$CID" >/dev/null
`, shellQuote(imageID), shellQuote(destDir))

	_, err := runUnshareScript(ctx, script)
	return err
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

func writeNsjailCfg(buildDir, path string, args []string) error {
	tmpl, err := template.New("nsjail.cfg").Parse(nsjailCfgTmpl)
	if err != nil {
		return err
	}

	dir := filepath.Join(buildDir, "etc", "sce")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	out, err := os.Create(filepath.Join(dir, "nsjail.cfg"))
	if err != nil {
		return err
	}
	defer out.Close()

	return tmpl.Execute(out, struct {
		Path string
		Args []string
	}{Path: path, Args: args})
}

func writeContainerfile(buildDir string) error {
	containerfile := `FROM ` + nsjailBaseImage + `
COPY etc/sce/nsjail.cfg /etc/sce/nsjail.cfg
COPY opt/controller/rootfs /opt/controller/rootfs
ENTRYPOINT ["/bin/nsjail", "--config", "/etc/sce/nsjail.cfg"]
`
	return os.WriteFile(filepath.Join(buildDir, "Containerfile"), []byte(containerfile), 0o644)
}

// buildAndSave builds the composed image from buildDir, saves it to outTar
// (docker-archive format - keeps it loadable with `docker load` for local
// verification), and cleans up both the built image and the pulled source
// image from buildah's local storage.
func buildAndSave(ctx context.Context, buildDir, tag, sourceImageID, outTar string) error {
	script := fmt.Sprintf(`set -e
buildah build -t %s -f %s %s
buildah push %s docker-archive:%s
buildah rmi %s %s >/dev/null 2>&1 || true
`,
		shellQuote(tag), shellQuote(filepath.Join(buildDir, "Containerfile")), shellQuote(buildDir),
		shellQuote(tag), shellQuote(outTar),
		shellQuote(tag), shellQuote(sourceImageID),
	)

	_, err := runUnshareScript(ctx, script)
	return err
}

// runBuildah runs a single buildah subcommand inside a rootless user
// namespace (`buildah unshare`), returning stdout. buildah's own progress
// output goes to stderr, so stdout stays clean for parsing.
func runBuildah(ctx context.Context, args ...string) (string, error) {
	fullArgs := append([]string{"unshare", "buildah"}, args...)
	cmd := exec.CommandContext(ctx, "buildah", fullArgs...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("buildah %s: %w: %s", strings.Join(args, " "), err, stderr.String())
	}
	return stdout.String(), nil
}

// runUnshareScript runs a multi-step bash script inside a single rootless
// user namespace - needed whenever a step's output (like a mount point)
// only exists within that namespace and a later step needs to see it.
func runUnshareScript(ctx context.Context, script string) (string, error) {
	cmd := exec.CommandContext(ctx, "buildah", "unshare", "--", "bash", "-c", script)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("buildah unshare script: %w: %s", err, stderr.String())
	}
	return stdout.String(), nil
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
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
