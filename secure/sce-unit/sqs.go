package main

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

// The host runs a vsock-proxy that forwards this port to sqs.<region>.amazonaws.com:443 (see
// userdata.sh.tmpl), so the result is published by the enclave rather than relayed through the host.
const sqsProxyPort = 8004

const sqsRequestTimeout = 30 * time.Second

// sendResult publishes a run result to the results queue from inside the enclave. The host is untrusted;
// routing SendMessage from here keeps the message body inside the trust boundary instead of having the
// host reassemble it from a vsock relay. TLS terminates against the real SQS endpoint through the proxy.
func sendResult(cfg runConfig, creds awsCreds, queueURL, body string) error {
	endpoint := fmt.Sprintf("sqs.%s.amazonaws.com", cfg.Region)
	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(cfg.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			creds.AccessKeyId, creds.SecretAccessKey, creds.SessionToken)),
		config.WithHTTPClient(vsockAWSEndpointHTTPClient(endpoint, sqsProxyPort)),
	)
	if err != nil {
		return fmt.Errorf("load AWS config: %w", err)
	}
	client := sqs.NewFromConfig(awsCfg)

	ctx, cancel := context.WithTimeout(context.Background(), sqsRequestTimeout)
	defer cancel()
	if _, err := client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    &queueURL,
		MessageBody: &body,
	}); err != nil {
		return fmt.Errorf("sqs send-message: %w", err)
	}
	return nil
}
