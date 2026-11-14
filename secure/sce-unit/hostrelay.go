package main

import (
	"bufio"
	"encoding/json"
	"log"
	"net"
	"time"

	sharedlog "github.com/Secure-RADS/st-dp/packages/go-common/log"
	"github.com/mdlayher/vsock"
)

// The host buffers its timeline events and relays them over this vsock port once the enclave is listening.
// The host is untrusted, so only a fixed allowlist is forwarded, and every relayed event keeps origin=host.
const hostEventPort = 5003

var hostEventAllowlist = map[string]bool{
	sharedlog.EventExecutorReady:     true,
	sharedlog.EventArtifactRetrieved: true,
	sharedlog.EventEnclaveLaunched:   true,
}

type relayedHostEvent struct {
	Event     string         `json:"event"`
	Timestamp string         `json:"timestamp"`
	Detail    map[string]any `json:"detail"`
}

func startHostEventRelay(timelineLog *sharedlog.Client, algorithmID, runID string) {
	listener, err := vsock.Listen(hostEventPort, nil)
	if err != nil {
		log.Printf("sce-unit: host event relay unavailable: %v", err)
		return
	}

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				log.Printf("sce-unit: host event relay stopped: %v", err)
				return
			}
			go readHostEvents(conn, timelineLog, algorithmID, runID)
		}
	}()
}

func readHostEvents(conn net.Conn, timelineLog *sharedlog.Client, algorithmID, runID string) {
	defer conn.Close()
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 4096), 64*1024)
	for scanner.Scan() {
		var event relayedHostEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			log.Printf("sce-unit: dropping malformed host event: %v", err)
			continue
		}
		if !hostEventAllowlist[event.Event] {
			log.Printf("sce-unit: dropping host event not in allowlist: %q", event.Event)
			continue
		}
		timestamp := event.Timestamp
		if _, err := time.Parse(time.RFC3339Nano, timestamp); err != nil {
			timestamp = ""
		}
		timelineLog.EmitHostEventAt(algorithmID, &runID, event.Event, timestamp, event.Detail)
	}
}
