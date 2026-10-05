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

	"golang.org/x/sys/unix"
)

const (
	nsjailBin = "/bin/nsjail"
	nsjailCfg = "/etc/sce/nsjail.cfg"

	// Host paths under the DC rootfs; nsjail bind-mounts that rootfs at "/", so the jail sees /data/...
	dataDirHost     = "/opt/dc-app/rootfs/data"
	recordsFileHost = dataDirHost + "/records.json"
	resultFileHost  = dataDirHost + "/result.json"

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
	info := readRunInfo()
	runID := info.RunID
	logEvent(cfg, runID, eventEnclaveStarted, nil)

	// Must run before any crypto/rand use (attestation, TLS) - see entropy.go.
	if err := seedEntropy(); err != nil {
		log.Printf("sce-unit: seed entropy: %v", err)
	} else {
		log.Printf("sce-unit: seeded kernel entropy from NSM")
	}
	logEvent(cfg, runID, eventUnitReady, nil)

	// Attest, fetch, decrypt, and write records.json before nsjail starts - same file contract as rads.
	if err := prepareRecordsFile(cfg, runID, info.Size); err != nil {
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

	var jailLog bytes.Buffer
	cmd := exec.Command(nsjailBin, "--config", nsjailCfg)
	cmd.Stdout = io.MultiWriter(os.Stdout, &jailLog)
	cmd.Stderr = io.MultiWriter(os.Stderr, &jailLog)
	if err := cmd.Start(); err != nil {
		log.Fatalf("sce-unit: start nsjail: %v", err)
	}
	log.Printf("sce-unit: nsjail started (pid %d)", cmd.Process.Pid)

	waitErr := cmd.Wait()
	log.Printf("sce-unit: nsjail exited: %v", waitErr)

	output, readErr := os.ReadFile(resultFileHost)
	logEvent(cfg, runID, eventDCAppCompleted, map[string]any{"outputBytes": len(output)})

	failed := readErr != nil || len(output) == 0
	if failed {
		// The enclave console is lost when the host terminates, so deliver the failure and the jailed app's own output.
		log.Printf("sce-unit: result missing or empty: readErr=%v bytes=%d waitErr=%v", readErr, len(output), waitErr)
		failure, _ := json.Marshal(struct {
			Error   string `json:"error"`
			WaitErr string `json:"waitErr"`
			JailLog string `json:"jailLog"`
		}{
			Error:   fmt.Sprintf("dc app produced no result file: %v", readErr),
			WaitErr: fmt.Sprintf("%v", waitErr),
			JailLog: jailLog.String(),
		})
		output = append(failure, '\n')
	} else if output[len(output)-1] != '\n' {
		output = append(output, '\n')
	}
	if err := sendOutput(output); err != nil {
		log.Printf("sce-unit: send output to host failed: %v", err)
	}
	logEvent(cfg, runID, eventOutputSent, nil)
	if failed {
		os.Exit(1)
	}
}

// prepareRecordsFile attests, fetches ciphertext from pdm-service, decrypts, and writes the rads-shaped
// records.json the DC app loads via RECORDS_PATH.
func prepareRecordsFile(cfg runConfig, runID string, limit int) error {
	tp, err := attest(cfg)
	if err != nil {
		return fmt.Errorf("attestation failed: %w", err)
	}
	log.Printf("sce-unit: attested successfully, access token expires %s", tp.AccessTokenExpiresAt.Format(time.RFC3339))
	logEvent(cfg, runID, eventAttested, nil)
	setTokens(tp)
	go refreshLoop(cfg)

	creds, err := fetchAWSCreds()
	if err != nil {
		return fmt.Errorf("fetch AWS creds: %w", err)
	}

	records, encDataKey, err := fetchAllRecords(cfg, runID, limit)
	if err != nil {
		return fmt.Errorf("fetch records: %w", err)
	}
	log.Printf("sce-unit: fetched %d records from pdm-service", len(records))
	logEvent(cfg, runID, eventRecordsFetched, map[string]any{"count": len(records)})

	// pdm-service only ever returns ciphertext; the data key that unwraps it is obtained from KMS under
	// this enclave's attestation. Only the measured image can do this - see the per-algorithm key policy.
	dek, err := decryptDataKey(cfg, creds, encDataKey)
	if err != nil {
		return fmt.Errorf("decrypt data key: %w", err)
	}
	log.Printf("sce-unit: unwrapped data key via KMS (%d bytes)", len(dek))

	plainRecords := make([]pdmRecord, 0, len(records))
	for _, rec := range records {
		plain, derr := decryptRecord(dek, rec.Data)
		if derr != nil {
			return fmt.Errorf("decrypt record: %w", derr)
		}
		plainRecords = append(plainRecords, pdmRecord{RecordId: rec.RecordId, Data: plain})
	}
	log.Printf("sce-unit: decrypted %d records", len(plainRecords))

	body, err := json.Marshal(struct {
		AlgorithmId string      `json:"algorithmId"`
		Records     []pdmRecord `json:"records"`
	}{AlgorithmId: cfg.AlgorithmId, Records: plainRecords})
	if err != nil {
		return fmt.Errorf("marshal records file: %w", err)
	}
	if err := os.MkdirAll(dataDirHost, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", dataDirHost, err)
	}
	// Drop a leftover result from a prior attempt in this rootfs (fresh EIFs are clean; defensive).
	_ = os.Remove(resultFileHost)
	if err := os.WriteFile(recordsFileHost, body, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", recordsFileHost, err)
	}
	log.Printf("sce-unit: wrote %d bytes to %s", len(body), recordsFileHost)
	// End of data retrieval for benchmarks: fetch + decrypt + write (see export.py data_retrieval).
	logEvent(cfg, runID, eventDataDecrypted, nil)
	return nil
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
