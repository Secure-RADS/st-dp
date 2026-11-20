package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"time"

	sharedlog "github.com/Secure-RADS/st-dp/packages/go-common/log"
	"golang.org/x/sys/unix"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	nsjailBin = "/bin/nsjail"
	nsjailCfg = "/etc/sce/nsjail.cfg"

	// Host path to the DC rootfs; nsjail bind-mounts it at "/", so the jail sees /data/sce.sock.
	dataDirHost   = "/opt/dc-app/rootfs/data"
	rpcSocketHost = dataDirHost + "/sce.sock"

	// The parent EC2 instance is always CID 3 on Nitro; the host's user data listens on this port.
	hostCID         = 3
	hostOutputPort  = 5000
	vsockRetryWait  = 500 * time.Millisecond
	vsockRetryLimit = 20
)

func main() {
	log.Printf("sce-unit: starting up")

	cfg, err := loadRunConfig()
	if err != nil {
		log.Fatalf("sce-unit: load run config: %v", err)
	}
	var timelineLog *sharedlog.Client
	if cfg.TelemetryHost != "" {
		timelineLog = &sharedlog.Client{Host: cfg.TelemetryHost, HTTPClient: cfg.telemetry().client()}
	}
	var accessLog *sharedlog.Client
	if cfg.LogHost != "" {
		accessLog = &sharedlog.Client{Host: cfg.LogHost, HTTPClient: cfg.logSvc().client()}
		accessLog.Token = func() string {
			token, _ := CurrentAccessToken()
			return token
		}
	}
	info, err := readRunInfo()
	if err != nil {
		failRun(timelineLog, cfg.AlgorithmId, "", err)
	}
	runID := info.RunID
	timelineLog.EmitEvent(cfg.AlgorithmId, &runID, sharedlog.EventEnclaveStarted, nil)

	// Must run before any crypto/rand use (attestation, TLS) - see entropy.go.
	if err := seedEntropy(); err != nil {
		failRun(timelineLog, cfg.AlgorithmId, runID, fmt.Errorf("seed entropy: %w", err))
	}
	log.Printf("sce-unit: seeded kernel entropy from NSM")
	timelineLog.EmitEvent(cfg.AlgorithmId, &runID, sharedlog.EventUnitReady, nil)

	// The DC app pulls records over gRPC, so the socket must exist before the jail starts.
	if err := os.MkdirAll(dataDirHost, 0o755); err != nil {
		failRun(timelineLog, cfg.AlgorithmId, runID, fmt.Errorf("create %s: %w", dataDirHost, err))
	}
	_ = os.Remove(rpcSocketHost)

	server := newDataAccessServer(cfg, timelineLog, runID, info.Size)
	grpcServer, listener, err := serveRPC(rpcSocketHost, server)
	if err != nil {
		failRun(timelineLog, cfg.AlgorithmId, runID, err)
	}

	var jailLog bytes.Buffer
	cmd := exec.Command(nsjailBin, "--config", nsjailCfg)
	cmd.Stdout = io.MultiWriter(os.Stdout, &jailLog)
	cmd.Stderr = io.MultiWriter(os.Stderr, &jailLog)
	if err := cmd.Start(); err != nil {
		grpcServer.Stop()
		listener.Close()
		failRun(timelineLog, cfg.AlgorithmId, runID, fmt.Errorf("start nsjail: %w", err))
	}
	log.Printf("sce-unit: nsjail started (pid %d)", cmd.Process.Pid)

	waitErr := cmd.Wait()
	log.Printf("sce-unit: nsjail exited: %v", waitErr)
	grpcServer.Stop()
	listener.Close()

	result := server.submittedResult()
	failed := waitErr != nil || result == nil
	if failed {
		timelineLog.EmitEvent(cfg.AlgorithmId, &runID, sharedlog.EventRunFailed, map[string]any{
			"error": fmt.Sprintf("dc app failed: waitErr=%v resultSubmitted=%t", waitErr, result != nil),
		})
		failure, _ := json.Marshal(struct {
			Error   string `json:"error"`
			WaitErr string `json:"waitErr"`
			JailLog string `json:"jailLog"`
		}{
			Error:   "dc app produced no result",
			WaitErr: fmt.Sprintf("%v", waitErr),
			JailLog: jailLog.String(),
		})
		output := append(failure, '\n')
		if err := sendOutput(output); err != nil {
			log.Printf("sce-unit: send output to host failed: %v", err)
			timelineLog.EmitEvent(cfg.AlgorithmId, &runID, sharedlog.EventRunFailed, map[string]any{"error": err.Error()})
			os.Exit(1)
		}
		timelineLog.EmitEvent(cfg.AlgorithmId, &runID, sharedlog.EventOutputSent, nil)
		os.Exit(1)
	}

	output, err := protojson.Marshal(result)
	if err != nil {
		failRun(timelineLog, cfg.AlgorithmId, runID, fmt.Errorf("encode result: %w", err))
	}
	output = append(output, '\n')

	timelineLog.EmitEvent(cfg.AlgorithmId, &runID, sharedlog.EventDCAppCompleted, map[string]any{"outputBytes": len(output)})
	// DSAR trail: record the data subjects the app used only after it ran successfully, so a run that
	// never reached the DC app does not show up as an access.
	accessLog.EmitSubjectAccess(cfg.AlgorithmId, runID, server.dataSubjects())

	if err := sendOutput(output); err != nil {
		log.Printf("sce-unit: send output to host failed: %v", err)
		timelineLog.EmitEvent(cfg.AlgorithmId, &runID, sharedlog.EventRunFailed, map[string]any{"error": err.Error()})
		os.Exit(1)
	}
	timelineLog.EmitEvent(cfg.AlgorithmId, &runID, sharedlog.EventOutputSent, nil)
}

func failRun(timelineLog *sharedlog.Client, algorithmID, runID string, err error) {
	log.Printf("sce-unit: %v", err)
	if runID != "" {
		timelineLog.EmitEvent(algorithmID, &runID, sharedlog.EventRunFailed, map[string]any{"error": err.Error()})
	}
	failure, _ := json.Marshal(struct {
		Error string `json:"error"`
	}{Error: err.Error()})
	if err := sendOutput(append(failure, '\n')); err != nil {
		log.Printf("sce-unit: send error to host failed: %v", err)
	}
	os.Exit(1)
}

// sendOutput streams the DC app's result to the parent instance over vsock - the enclave's only channel out.
func sendOutput(output []byte) error {
	fd, err := unix.Socket(unix.AF_VSOCK, unix.SOCK_STREAM, 0)
	if err != nil {
		return err
	}
	defer unix.Close(fd)

	addr := &unix.SockaddrVM{CID: hostCID, Port: hostOutputPort}
	for i := 0; ; i++ {
		err = unix.Connect(fd, addr)
		if err == nil {
			break
		}
		if i >= vsockRetryLimit {
			return err
		}
		time.Sleep(vsockRetryWait)
	}
	log.Printf("sce-unit: connected to host vsock %d:%d, sending %d bytes", hostCID, hostOutputPort, len(output))

	for len(output) > 0 {
		n, err := unix.Write(fd, output)
		if err != nil {
			return err
		}
		output = output[n:]
	}
	return nil
}
