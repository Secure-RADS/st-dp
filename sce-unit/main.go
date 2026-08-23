package main

import (
	"bufio"
	"bytes"
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

	output, err := relayRequest()
	if err != nil {
		log.Printf("sce-unit: relay failed: %v", err)
	}
	if err := sendOutput(output); err != nil {
		log.Printf("sce-unit: send output to host failed: %v", err)
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

// relayRequest polls for the DC app's socket (created after nsjail starts it), sends a trivial trigger, and returns the response.
func relayRequest() ([]byte, error) {
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
	log.Printf("sce-unit: connected to dc app, sending request")

	if _, err := conn.Write([]byte("RUN\n")); err != nil {
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

// sendOutput streams the DC app's response to the parent instance over vsock
// - the enclave's only channel out; the host writes it to S3 for the caller.
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
