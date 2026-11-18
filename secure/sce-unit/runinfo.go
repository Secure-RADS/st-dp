package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"golang.org/x/sys/unix"
)

// The host serves this run's runId on this vsock port - the enclave takes no user-data of its own, so it has
// no other way to learn the per-run id it was launched for (the EIF only carries the per-algorithm config).
const hostRunIDPort = 5001

// runInfo is the per-run data the host serves on hostRunIDPort: the run id, the run secret execution-service
// registered for it, and how many records to read (0 = the whole dataset). The host is untrusted, so these
// are claims: the secret only proves itself to verifier-service, never to the enclave.
type runInfo struct {
	RunID     string `json:"runId"`
	RunSecret string `json:"runSecret"`
	Size      int    `json:"size"`
}

func readRunInfo() (runInfo, error) {
	fd, err := unix.Socket(unix.AF_VSOCK, unix.SOCK_STREAM, 0)
	if err != nil {
		return runInfo{}, fmt.Errorf("create run-info socket: %w", err)
	}
	defer unix.Close(fd)

	addr := &unix.SockaddrVM{CID: hostCID, Port: hostRunIDPort}
	for i := 0; ; i++ {
		err := unix.Connect(fd, addr)
		if err == nil {
			break
		}
		if i >= vsockRetryLimit {
			return runInfo{}, fmt.Errorf("connect run-info socket: %w", err)
		}
		time.Sleep(vsockRetryWait)
	}

	var buf bytes.Buffer
	chunk := make([]byte, 256)
	for {
		n, err := unix.Read(fd, chunk)
		if n > 0 {
			buf.Write(chunk[:n])
		}
		if err != nil {
			// The host closes right after sending; vsock surfaces that as ENOTCONN/ECONNRESET, not EOF.
			if errors.Is(err, unix.ENOTCONN) || errors.Is(err, unix.ECONNRESET) {
				break
			}
			return runInfo{}, fmt.Errorf("read run-info: %w", err)
		}
		if n == 0 {
			break
		}
	}

	var info runInfo
	if err := json.Unmarshal(buf.Bytes(), &info); err != nil {
		return runInfo{}, fmt.Errorf("decode run-info: %w", err)
	}
	if info.RunID == "" || info.RunSecret == "" || info.Size < 0 {
		return runInfo{}, fmt.Errorf("invalid run-info: runId and runSecret must be nonempty and size nonnegative")
	}
	return info, nil
}
