package main

import (
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/mdlayher/vsock"
)

// The enclave has no IMDS and no user-data, so its AWS credentials come from the parent host, which serves
// fresh IMDSv2 role credentials over vsock (port 5002, see userdata.sh.tmpl) - the same channel that serves
// the runId. The host holds the role; KMS's attestation-condition key policy is what stops the host from
// using those credentials to decrypt on its own.
const hostCredsPort = 5002

type awsCreds struct {
	AccessKeyId     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	SessionToken    string `json:"sessionToken"`
}

func fetchAWSCreds() (awsCreds, error) {
	conn, err := vsock.Dial(hostCID, hostCredsPort, nil)
	if err != nil {
		return awsCreds{}, fmt.Errorf("dial host creds vsock: %w", err)
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return awsCreds{}, err
	}
	data, err := io.ReadAll(io.LimitReader(conn, 1<<16))
	if err != nil {
		return awsCreds{}, fmt.Errorf("read host creds: %w", err)
	}
	var creds awsCreds
	if err := json.Unmarshal(data, &creds); err != nil {
		return awsCreds{}, fmt.Errorf("parse host creds: %w", err)
	}
	return creds, nil
}