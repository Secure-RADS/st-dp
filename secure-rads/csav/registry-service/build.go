package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
)

// buildAndPush unpacks the uploaded image, jails the Data Controller's app
// behind nsjail with the SCE Unit as entrypoint, builds a Nitro Enclave EIF
// from the result, and uploads only that to S3. The whole pipeline is
// daemonless: skopeo + rootless umoci for unpack, eif_build directly on the
// composed rootfs (eif.go) - no docker.sock anywhere.
func buildAndPush(ctx context.Context, algorithmId, tarPath, existingKmsKeyArn string) (key, kmsKeyArn string, err error) {
	start := time.Now()
	log.Printf("build[%s]: start", tarPath)

	// buildId is the runId under which this build's timeline is recorded (a build has no execution runId).
	buildId := uuid.NewString()
	logEvent(algorithmId, buildId, eventBuildStarted, nil)
	defer func() {
		if err != nil {
			logEvent(algorithmId, buildId, eventBuildFailed, map[string]any{"error": err.Error()})
		}
	}()

	workDir := filepath.Join(os.TempDir(), "registry-build-"+algorithmId)
	if err := os.Mkdir(workDir, 0o755); err != nil {
		return "", "", err
	}
	defer os.RemoveAll(workDir)

	layoutDir := filepath.Join(workDir, "layout")
	bundleDir := filepath.Join(workDir, "bundle")

	log.Printf("build[%s]: skopeo copy in", tarPath)
	if _, err := run(ctx, "skopeo", "copy", "docker-archive:"+tarPath, "oci:"+layoutDir+":src"); err != nil {
		return "", "", fmt.Errorf("skopeo copy in: %w", err)
	}

	log.Printf("build[%s]: umoci unpack", tarPath)
	if _, err := run(ctx, "umoci", "unpack", "--rootless", "--image", layoutDir+":src", bundleDir); err != nil {
		return "", "", fmt.Errorf("umoci unpack: %w", err)
	}

	cfg, err := readOCIConfig(bundleDir)
	if err != nil {
		return "", "", err
	}
	if len(cfg.Process.Args) == 0 {
		return "", "", fmt.Errorf("image has no entrypoint/cmd - nothing to jail")
	}
	execPath, args := cfg.Process.Args[0], cfg.Process.Args[1:]

	pathEnv, err := pathFromEnv(cfg.Process.Env)
	if err != nil {
		return "", "", err
	}

	dcRootfs := filepath.Join(bundleDir, "rootfs")
	execPath, err = resolveExecPath(dcRootfs, execPath, pathEnv)
	if err != nil {
		return "", "", err
	}
	log.Printf("build[%s]: resolved entrypoint %s %v", tarPath, execPath, args)

	if verifierHost == "" || verifierHostPubKeySHA256 == "" {
		return "", "", fmt.Errorf("VERIFIER_HOST / VERIFIER_HOST_PUBKEY_SHA256 not configured")
	}
	if pdmHost == "" || pdmHostPubKeySHA256 == "" {
		return "", "", fmt.Errorf("PDM_HOST / PDM_HOST_PUBKEY_SHA256 not configured")
	}
	if logHost == "" || logHostPubKeySHA256 == "" {
		return "", "", fmt.Errorf("LOG_HOST / LOG_HOST_PUBKEY_SHA256 not configured")
	}

	log.Printf("build[%s]: composing final rootfs", tarPath)
	rc := runConfig{
		AlgorithmId:  algorithmId,
		VerifierHost: verifierHost, VerifierPubKeySHA256: verifierHostPubKeySHA256,
		PdmHost: pdmHost, PdmPubKeySHA256: pdmHostPubKeySHA256,
		LogHost: logHost, LogPubKeySHA256: logHostPubKeySHA256,
		Region: region,
	}
	if err := composeFinalRootfs(bundleDir, execPath, pathEnv, args, rc); err != nil {
		return "", "", fmt.Errorf("compose final rootfs: %w", err)
	}

	log.Printf("build[%s]: building EIF", tarPath)
	eifPath, pcrs, err := buildEIF(ctx, dcRootfs, workDir)
	if err != nil {
		return "", "", fmt.Errorf("build EIF: %w", err)
	}
	logEvent(algorithmId, buildId, eventEifBuilt, map[string]any{"pcr0": pcrs.PCR0})

	f, err := os.Open(eifPath)
	if err != nil {
		return "", "", err
	}
	defer f.Close()

	key = algorithmId + ".eif"
	log.Printf("build[%s]: uploading to s3 key=%s", tarPath, key)
	if err := uploadToS3(ctx, key, f); err != nil {
		return "", "", fmt.Errorf("upload EIF: %w", err)
	}
	logEvent(algorithmId, buildId, eventImageUploaded, map[string]any{"bucket": artifactBucket, "key": key})

	log.Printf("build[%s]: registering PCRs with verifier-service", tarPath)
	if err := registerPCRs(ctx, algorithmId, pcrs); err != nil {
		return "", "", fmt.Errorf("register PCRs: %w", err)
	}
	logEvent(algorithmId, buildId, eventPcrsRegistered, nil)

	log.Printf("build[%s]: ensuring per-algorithm KMS key", tarPath)
	if enclaveHostRoleArn == "" {
		return "", "", fmt.Errorf("ENCLAVE_HOST_ROLE_ARN not configured")
	}
	if csavRoleArn == "" {
		return "", "", fmt.Errorf("CSAV_ROLE_ARN not configured")
	}
	kmsKeyArn, err = ensureAlgorithmKmsKey(ctx, algorithmId, pcrs, existingKmsKeyArn, enclaveHostRoleArn, csavRoleArn)
	if err != nil {
		return "", "", fmt.Errorf("provision KMS key: %w", err)
	}
	logEvent(algorithmId, buildId, eventKmsKeyProvisioned, map[string]any{"kmsKeyArn": kmsKeyArn, "reused": existingKmsKeyArn != ""})

	log.Printf("build[%s]: done key=%s took=%s", tarPath, key, time.Since(start))
	logEvent(algorithmId, buildId, eventBuildCompleted, map[string]any{"key": key})
	return key, kmsKeyArn, nil
}
