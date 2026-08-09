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
	socketDir     = "/opt/dc-app/rootfs/run/sce"
	socketPath    = socketDir + "/dc.sock"
	dialTimeout   = 10 * time.Second
	dialRetryWait = 100 * time.Millisecond
)

func main() {
	log.Printf("sce-unit: starting up")

	if err := os.MkdirAll(socketDir, 0o755); err != nil {
		log.Fatalf("sce-unit: create %s: %v", socketDir, err)
	}
	log.Printf("sce-unit: socket dir ready: %s", socketDir)

	cmd := exec.Command(nsjailBin, "--config", nsjailCfg)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Fatalf("sce-unit: start nsjail: %v", err)
	}
	log.Printf("sce-unit: nsjail started (pid %d)", cmd.Process.Pid)

	if err := relayRequest(); err != nil {
		log.Printf("sce-unit: relay failed: %v", err)
	}

	log.Printf("sce-unit: waiting for nsjail to exit")
	if err := cmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			log.Printf("sce-unit: nsjail exited with code %d", exitErr.ExitCode())
			os.Exit(exitErr.ExitCode())
		}
		log.Fatalf("sce-unit: nsjail wait: %v", err)
	}
	log.Printf("sce-unit: nsjail exited cleanly")
}

// relayRequest dials the DC app's socket once it appears (the DC app
// creates the socket file itself, inside the jail, after nsjail starts it -
// so this has to poll rather than dial immediately), sends a trivial
// trigger, and logs whatever comes back.
func relayRequest() error {
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
		return err
	}
	defer conn.Close()
	log.Printf("sce-unit: connected to dc app, sending request")

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
