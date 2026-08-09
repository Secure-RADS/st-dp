package main

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"text/template"
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
