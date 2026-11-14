package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"

	"golang.org/x/sys/unix"
)

// The host serves this run's runId on this vsock port - the enclave takes no user-data of its own, so it has
// no other way to learn the per-run id it was launched for (the EIF only carries the per-algorithm config).
const hostRunIDPort = 5001

// runInfo is the per-run data the host serves on hostRunIDPort: the run id, how many records to read
// (0 = the whole dataset), the instance id, and the results queue URL the enclave publishes to. The
// enclave takes no user-data, so this is its only source for all four.
type runInfo struct {
	RunID      string `json:"runId"`
	Size       int    `json:"size"`
	InstanceID string `json:"instanceId"`
	QueueURL   string `json:"queueUrl"`
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
	if info.RunID == "" || info.Size < 0 || info.QueueURL == "" {
		return runInfo{}, fmt.Errorf("invalid run-info: runId and queueUrl must be nonempty and size must be nonnegative")
	}
	return info, nil
}
