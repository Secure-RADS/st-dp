// The SCE Unit: the image's real entrypoint. Runs as root, spawns nsjail
// (which drops the Data Controller's app into its jail), then connects out
// to the DC app as a client over a unix socket to relay a request and log
// the response.
package main

import (
	"bufio"
	"log"
	"net"
	"os"
	"os/exec"
	"time"
)

const (
	nsjailBin = "/bin/nsjail"
	nsjailCfg = "/etc/sce/nsjail.cfg"

	// This is the SCE Unit's own (unjailed) view of the shared socket
	// directory - nsjail bind-mounts the same underlying directory into
	// the jail as /run/sce, see nsjail.cfg.tmpl.
	socketDir     = "/opt/controller/rootfs/run/sce"
	socketPath    = socketDir + "/dc.sock"
	dialTimeout   = 10 * time.Second
	dialRetryWait = 100 * time.Millisecond
)

func main() {
	if err := os.MkdirAll(socketDir, 0o755); err != nil {
		log.Fatalf("sce-unit: create %s: %v", socketDir, err)
	}

	cmd := exec.Command(nsjailBin, "--config", nsjailCfg)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Fatalf("sce-unit: start nsjail: %v", err)
	}

	if err := relayRequest(); err != nil {
		log.Printf("sce-unit: relay failed: %v", err)
	}

	if err := cmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		log.Fatalf("sce-unit: nsjail wait: %v", err)
	}
}

// relayRequest dials the DC app's socket once it appears (the DC app
// creates the socket file itself, inside the jail, after nsjail starts it -
// so this has to poll rather than dial immediately), sends a trivial
// trigger, and logs whatever comes back.
func relayRequest() error {
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
		return err
	}
	defer conn.Close()

	if _, err := conn.Write([]byte("RUN\n")); err != nil {
		return err
	}

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		log.Printf("sce-unit: dc app response: %s", scanner.Text())
	}
	return scanner.Err()
}
