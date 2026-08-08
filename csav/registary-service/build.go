package main

import (
	"archive/tar"
	"bufio"
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

//go:embed nsjail.cfg.tmpl
var nsjailCfgTmpl string

const nsjailBaseImage = "nsjail-base:latest"

// buildAndPush unpacks the uploaded OCI image, jails the Data Controller's
// app behind nsjail, rebuilds a new image with that layout, and streams the
// result straight to S3. The raw upload never gets persisted - only this
// composed output does.
func buildAndPush(ctx context.Context, tarPath string) (string, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return "", fmt.Errorf("docker client: %w", err)
	}
	defer cli.Close()

	f, err := os.Open(tarPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	loadResp, err := cli.ImageLoad(ctx, f, true)
	if err != nil {
		return "", fmt.Errorf("image load: %w", err)
	}
	defer loadResp.Body.Close()

	sourceRef, err := parseLoadedImageRef(loadResp.Body)
	if err != nil {
		return "", fmt.Errorf("parse loaded image ref: %w", err)
	}

	inspect, _, err := cli.ImageInspectWithRaw(ctx, sourceRef)
	if err != nil {
		return "", fmt.Errorf("inspect image: %w", err)
	}

	// Docker's own exec model: ENTRYPOINT + CMD concatenated, ENTRYPOINT's
	// tail (e.g. the "/main.py" in ["python3", "/main.py"]) is arguments,
	// not something to discard.
	full := append(append([]string{}, inspect.Config.Entrypoint...), inspect.Config.Cmd...)
	if len(full) == 0 {
		return "", fmt.Errorf("image %s has no ENTRYPOINT or CMD - nothing to jail", sourceRef)
	}
	entrypoint, args := full[:1], full[1:]

	buildDir, err := os.MkdirTemp("", "registry-build-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(buildDir)

	rootfsDir := filepath.Join(buildDir, "opt", "controller", "rootfs")
	if err := os.MkdirAll(rootfsDir, 0o755); err != nil {
		return "", err
	}

	if err := exportRootfs(ctx, cli, sourceRef, rootfsDir); err != nil {
		return "", fmt.Errorf("export rootfs: %w", err)
	}

	execPath := resolveExecPath(rootfsDir, entrypoint[0], inspect.Config.Env)
	if err := writeNsjailCfg(buildDir, execPath, args); err != nil {
		return "", err
	}

	if err := writeDockerfile(buildDir); err != nil {
		return "", err
	}

	builtTag := strings.ReplaceAll(strings.TrimSuffix(filepath.Base(tarPath), filepath.Ext(tarPath)), ":", "-") + "-built:latest"
	if err := buildImage(ctx, cli, buildDir, builtTag); err != nil {
		return "", fmt.Errorf("build image: %w", err)
	}

	saveResp, err := cli.ImageSave(ctx, []string{builtTag})
	if err != nil {
		return "", fmt.Errorf("save image: %w", err)
	}
	defer saveResp.Close()

	key := strings.ReplaceAll(builtTag, ":", "-") + ".tar"
	if err := uploadToS3(ctx, key, saveResp); err != nil {
		return "", fmt.Errorf("upload built image: %w", err)
	}

	return key, nil
}

// parseLoadedImageRef reads the ImageLoad response stream for the
// "Loaded image: <ref>" line docker emits.
func parseLoadedImageRef(body io.Reader) (string, error) {
	scanner := bufio.NewScanner(body)
	for scanner.Scan() {
		var msg struct {
			Stream string `json:"stream"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue
		}
		if ref, ok := strings.CutPrefix(strings.TrimSpace(msg.Stream), "Loaded image: "); ok {
			return ref, nil
		}
	}
	return "", fmt.Errorf("no image ref found in load response")
}

func exportRootfs(ctx context.Context, cli *client.Client, imageRef, destDir string) error {
	created, err := cli.ContainerCreate(ctx, &container.Config{Image: imageRef}, nil, nil, nil, "")
	if err != nil {
		return err
	}
	defer cli.ContainerRemove(ctx, created.ID, container.RemoveOptions{Force: true})

	export, err := cli.ContainerExport(ctx, created.ID)
	if err != nil {
		return err
	}
	defer export.Close()

	return extractTar(export, destDir)
}

func extractTar(r io.Reader, destDir string) error {
	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		target := filepath.Join(destDir, hdr.Name)
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(hdr.Mode)); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(hdr.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		case tar.TypeSymlink:
			os.MkdirAll(filepath.Dir(target), 0o755)
			os.Symlink(hdr.Linkname, target)
		}
	}
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

func writeDockerfile(buildDir string) error {
	dockerfile := `FROM ` + nsjailBaseImage + `
COPY etc/sce/nsjail.cfg /etc/sce/nsjail.cfg
COPY opt/controller/rootfs /opt/controller/rootfs
ENTRYPOINT ["/bin/nsjail", "--config", "/etc/sce/nsjail.cfg"]
`
	return os.WriteFile(filepath.Join(buildDir, "Dockerfile"), []byte(dockerfile), 0o644)
}

func buildImage(ctx context.Context, cli *client.Client, buildDir, tag string) error {
	contextTar, err := tarDir(buildDir)
	if err != nil {
		return err
	}

	resp, err := cli.ImageBuild(ctx, contextTar, types.ImageBuildOptions{
		Tags:       []string{tag},
		Dockerfile: "Dockerfile",
		Remove:     true,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		var msg struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(scanner.Bytes(), &msg) == nil && msg.Error != "" {
			return fmt.Errorf("build error: %s", msg.Error)
		}
	}
	return scanner.Err()
}

// uploadToS3 streams body (unknown length, not seekable - as with
// docker's ImageSave response) via multipart upload rather than PutObject,
// which requires a known Content-Length or a seekable body.
func uploadToS3(ctx context.Context, key string, body io.Reader) error {
	uploader := manager.NewUploader(s3Client)
	_, err := uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: &artifactBucket,
		Key:    &key,
		Body:   body,
	})
	return err
}

func tarDir(dir string) (io.Reader, error) {
	buf := &bytes.Buffer{}
	tw := tar.NewWriter(buf)

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil || rel == "." {
			return err
		}

		linkTarget := ""
		if info.Mode()&os.ModeSymlink != 0 {
			linkTarget, err = os.Readlink(path)
			if err != nil {
				return err
			}
		}

		hdr, err := tar.FileInfoHeader(info, linkTarget)
		if err != nil {
			return err
		}
		hdr.Name = rel

		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			if _, err := io.Copy(tw, f); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	return buf, nil
}
