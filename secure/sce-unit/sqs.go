package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

// The host forwards this port over vsock to sqs.<region>.amazonaws.com:443 (see userdata.sh.tmpl). TLS still
// terminates at the real SQS endpoint, so the host relays bytes but cannot read or change the result.
const sqsProxyPort = 8005

const sqsRequestTimeout = 30 * time.Second

// sendSQSResult writes the already-signed envelope straight to the run-results queue using credentials
// borrowed from the host. The host relays the TLS bytes but cannot read or change the signed payload.
func sendSQSResult(info runInfo, envelope []byte) error {
	creds, err := fetchAWSCreds()
	if err != nil {
		return fmt.Errorf("fetch host credentials: %w", err)
	}

	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(info.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			creds.AccessKeyID, creds.SecretAccessKey, creds.SessionToken)),
		config.WithHTTPClient(vsockSQSHTTPClient(info.Region)),
	)
	if err != nil {
		return fmt.Errorf("load AWS config: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), sqsRequestTimeout)
	defer cancel()
	_, err = sqs.NewFromConfig(awsCfg).SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(info.QueueURL),
		MessageBody: aws.String(string(envelope)),
	})
	if err != nil {
		return fmt.Errorf("sqs send-message: %w", err)
	}
	return nil
}

// vsockSQSHTTPClient routes SQS HTTP/TLS through the host's vsock-proxy instead of real TCP. TLS verifies the
// real SQS endpoint certificate through the relay, so a compromised host cannot impersonate SQS.
func vsockSQSHTTPClient(region string) *http.Client {
	endpoint := fmt.Sprintf("sqs.%s.amazonaws.com", region)
	return &http.Client{
		Timeout: sqsRequestTimeout,
		Transport: &http.Transport{
			DisableKeepAlives: true,
			DialTLSContext: func(ctx context.Context, _ string, _ string) (net.Conn, error) {
				conn, err := dialVsock(ctx, hostCID, sqsProxyPort)
				if err != nil {
					return nil, err
				}
				if err := conn.SetDeadline(time.Now().Add(tlsHandshakeTimeout)); err != nil {
					conn.Close()
					return nil, err
				}
				tlsConn := tls.Client(conn, &tls.Config{ServerName: endpoint})
				if err := tlsConn.Handshake(); err != nil {
					conn.Close()
					return nil, err
				}
				if err := conn.SetDeadline(time.Time{}); err != nil {
					tlsConn.Close()
					return nil, err
				}
				return tlsConn, nil
			},
		},
	}
}
