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

func pathFromEnv(env []string) (string, error) {
	for _, e := range env {
		if v, ok := strings.CutPrefix(e, "PATH="); ok {
			return v, nil
		}
	}
	return "", fmt.Errorf("image does not declare a PATH env var - required")
}

// resolveExecPath turns a bare entrypoint like "python3" into an absolute
// in-jail path, since nsjail execve()s directly with no PATH lookup.
// Uses Lstat, not Stat: absolute symlinks (e.g. uv venvs) would otherwise
// resolve against the host filesystem instead of just checking existence.
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
