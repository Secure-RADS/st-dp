package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"time"

	"golang.org/x/sys/unix"
)

const (
	nsjailBin = "/bin/nsjail"
	nsjailCfg = "/etc/sce/nsjail.cfg"

	// SCE Unit's unjailed view of the shared socket dir - nsjail bind-mounts this same dir into the jail as /run/sce.
	socketDir     = "/opt/dc-app/rootfs/run/sce"
	socketPath    = socketDir + "/dc.sock"
	dialTimeout   = 10 * time.Second
	dialRetryWait = 100 * time.Millisecond

	// The parent EC2 instance is always CID 3 on Nitro; the host's user data listens on this port.
	hostCID         = 3
	hostOutputPort  = 5000
	vsockRetryWait  = 500 * time.Millisecond
	vsockRetryLimit = 20
)

func main() {
	log.Printf("sce-unit: starting up")

	// Must run before any crypto/rand use (attestation, TLS) - see entropy.go.
	if err := seedEntropy(); err != nil {
		log.Printf("sce-unit: seed entropy: %v", err)
	} else {
		log.Printf("sce-unit: seeded kernel entropy from NSM")
	}

	cfg, err := loadRunConfig()
	if err != nil {
		log.Fatalf("sce-unit: load run config: %v", err)
	}
	runID := readRunID()
	logEvent(cfg, runID, eventEnclaveStarted, nil)

	// Attest and fetch the data before nsjail starts - the DC app can't run without its records, and starting
	// the jail only to leave it blocked on a connection that never comes would hang the whole enclave.
	payload, err := prepareDCPayload(cfg, runID)
	if err != nil {
		log.Printf("sce-unit: %v", err)
		logEvent(cfg, runID, eventRunFailed, map[string]any{"error": err.Error()})
		failure, _ := json.Marshal(struct {
			Error string `json:"error"`
		}{Error: err.Error()})
		if err := sendOutput(append(failure, '\n')); err != nil {
			log.Printf("sce-unit: send error to host failed: %v", err)
		}
		os.Exit(1)
	}

	if err := os.MkdirAll(socketDir, 0o755); err != nil {
		log.Fatalf("sce-unit: create %s: %v", socketDir, err)
	}
	log.Printf("sce-unit: socket dir ready: %s", socketDir)

	var jailLog bytes.Buffer
	cmd := exec.Command(nsjailBin, "--config", nsjailCfg)
	cmd.Stdout = io.MultiWriter(os.Stdout, &jailLog)
	cmd.Stderr = io.MultiWriter(os.Stderr, &jailLog)
	if err := cmd.Start(); err != nil {
		log.Fatalf("sce-unit: start nsjail: %v", err)
	}
	log.Printf("sce-unit: nsjail started (pid %d)", cmd.Process.Pid)

	output, err := relayRequest(payload)

	log.Printf("sce-unit: waiting for nsjail to exit")
	waitErr := cmd.Wait()

	logEvent(cfg, runID, eventDCAppCompleted, map[string]any{"outputBytes": len(output)})

	if err != nil || len(output) == 0 {
		// The enclave console is lost when the host terminates, so deliver the failure and the jailed app's own output - otherwise an empty relay looks like an app that just printed nothing.
		log.Printf("sce-unit: relay failed or empty: err=%v bytes=%d waitErr=%v", err, len(output), waitErr)
		failure, _ := json.Marshal(struct {
			Error   string `json:"error"`
			WaitErr string `json:"waitErr"`
			JailLog string `json:"jailLog"`
		}{
			Error:   fmt.Sprintf("relay to dc app produced no output: %v", err),
			WaitErr: fmt.Sprintf("%v", waitErr),
			JailLog: jailLog.String(),
		})
		output = append(failure, '\n')
	}
	if err := sendOutput(output); err != nil {
		log.Printf("sce-unit: send output to host failed: %v", err)
	}
	logEvent(cfg, runID, eventOutputSent, nil)
}

// prepareDCPayload attests, fetches this algorithm's records from pdm-service, and returns the single JSON
// line handed to the DC app over its socket.
func prepareDCPayload(cfg runConfig, runID string) ([]byte, error) {
	tp, err := attest(cfg)
	if err != nil {
		return nil, fmt.Errorf("attestation failed: %w", err)
	}
	log.Printf("sce-unit: attested successfully, access token expires %s", tp.AccessTokenExpiresAt.Format(time.RFC3339))
	logEvent(cfg, runID, eventAttested, nil)
	setTokens(tp)
	go refreshLoop(cfg)

	creds, err := fetchAWSCreds()
	if err != nil {
		return nil, fmt.Errorf("fetch AWS creds: %w", err)
	}

	records, encDataKey, err := fetchAllRecords(cfg, tp.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("fetch records: %w", err)
	}
	log.Printf("sce-unit: fetched %d records from pdm-service", len(records))
	logEvent(cfg, runID, eventRecordsFetched, map[string]any{"count": len(records)})

	// pdm-service only ever returns ciphertext; the data key that unwraps it is obtained from KMS under
	// this enclave's attestation. Only the measured image can do this - see the per-algorithm key policy.
	dek, err := decryptDataKey(cfg, creds, encDataKey)
	if err != nil {
		return nil, fmt.Errorf("decrypt data key: %w", err)
	}
	log.Printf("sce-unit: unwrapped data key via KMS (%d bytes)", len(dek))

	plainRecords := make([]json.RawMessage, 0, len(records))
	for _, rec := range records {
		plain, derr := decryptRecord(dek, rec)
		if derr != nil {
			return nil, fmt.Errorf("decrypt record: %w", derr)
		}
		plainRecords = append(plainRecords, plain)
	}
	log.Printf("sce-unit: decrypted %d records", len(plainRecords))

	payload, err := json.Marshal(struct {
		AlgorithmId string            `json:"algorithmId"`
		Records     []json.RawMessage `json:"records"`
	}{AlgorithmId: cfg.AlgorithmId, Records: plainRecords})
	if err != nil {
		return nil, fmt.Errorf("marshal DC payload: %w", err)
	}
	return append(payload, '\n'), nil
}

func relayRequest(payload []byte) ([]byte, error) {
	log.Printf("sce-unit: waiting for dc app socket at %s", socketPath)
	deadline := time.Now().Add(dialTimeout)
	var conn net.Conn
	var err error
	for time.Now().Before(deadline) {
		conn, err = net.Dial("unix", socketPath)
		if err == nil {
			break
		}
		time.Sleep(dialRetryWait)
	}
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	log.Printf("sce-unit: connected to dc app, sending %d byte payload", len(payload))

	if _, err := conn.Write(payload); err != nil {
		return nil, err
	}

	var out bytes.Buffer
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		log.Printf("sce-unit: dc app response: %s", scanner.Text())
		out.Write(scanner.Bytes())
		out.WriteByte('\n')
	}
	return out.Bytes(), scanner.Err()
}

// sendOutput streams the DC app's response to the parent instance over vsock - the enclave's only channel out.
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
