package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
