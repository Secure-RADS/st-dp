package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
)

// configureLogClient points build events at the log-service mTLS domain. The client cert is read from SSM
// with the CSAV instance role, so no private key is baked into the image.
func configureLogClient(ctx context.Context) error {
	host := os.Getenv("LOG_MTLS_HOST")
	if host == "" {
		return nil
	}
	pin := os.Getenv("LOG_MTLS_PUBKEY_SHA256")
	certParam := os.Getenv("LOG_MTLS_CERT_PARAM")
	keyParam := os.Getenv("LOG_MTLS_KEY_PARAM")
	if pin == "" || certParam == "" || keyParam == "" {
		return fmt.Errorf("LOG_MTLS_PUBKEY_SHA256, LOG_MTLS_CERT_PARAM, and LOG_MTLS_KEY_PARAM are required when LOG_MTLS_HOST is set")
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	ssmClient := ssm.NewFromConfig(cfg)
	withDecryption := true
	get := func(name string) (string, error) {
		out, err := ssmClient.GetParameter(ctx, &ssm.GetParameterInput{Name: &name, WithDecryption: &withDecryption})
		if err != nil {
			return "", fmt.Errorf("get %s: %w", name, err)
		}
		return *out.Parameter.Value, nil
	}

	certPEM, err := get(certParam)
	if err != nil {
		return err
	}
	keyPEM, err := get(keyParam)
	if err != nil {
		return err
	}
	cert, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
	if err != nil {
		return fmt.Errorf("load client cert: %w", err)
	}

	timelineLog.Host = host
	timelineLog.HTTPClient = &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				Certificates:          []tls.Certificate{cert},
				InsecureSkipVerify:    true,
				VerifyPeerCertificate: pinnedCertVerifier(pin),
			},
		},
	}
	return nil
}
