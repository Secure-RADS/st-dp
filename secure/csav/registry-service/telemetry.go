package main

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"time"
)

// configureTelemetryClient pins telemetry-service's leaf public key instead of relying on the container's
// CA store. The pin is already baked into the EIF run config for the enclave, so build events use the same
// trust anchor.
func configureTelemetryClient() error {
	if telemetryHost == "" {
		return nil
	}
	if telemetryHostPubKeySHA256 == "" {
		return fmt.Errorf("TELEMETRY_HOST_PUBKEY_SHA256 is required when TELEMETRY_HOST is set")
	}

	timelineLog.Host = telemetryHost
	timelineLog.HTTPClient = &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify:    true,
				VerifyPeerCertificate: pinnedCertVerifier(telemetryHostPubKeySHA256),
			},
		},
	}
	return nil
}
