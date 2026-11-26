package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"
)

// The host forwards this port over vsock to the DC webhook host:port (see userdata.sh.tmpl). The host is
// untrusted, so TLS uses the normal CA chain and the webhook hostname - unlike the fixed internal services,
// the webhook can be any public host and cannot be pinned ahead of time.
const webhookProxyPort = 8006

const webhookRequestTimeout = 30 * time.Second

func sendWebhookResult(info runInfo, envelope []byte) error {
	target, err := url.Parse(info.WebhookURL)
	if err != nil || target.Scheme != "https" || target.Hostname() == "" {
		return fmt.Errorf("invalid webhook URL")
	}

	body := bytes.NewReader(envelope)
	for attempt := 1; ; attempt++ {
		err := postWebhook(target, body)
		if err == nil {
			return nil
		}
		if attempt >= 3 {
			return err
		}
		time.Sleep(time.Duration(attempt) * time.Second)
		body = bytes.NewReader(envelope)
	}
}

func postWebhook(target *url.URL, body *bytes.Reader) error {
	ctx, cancel := context.WithTimeout(context.Background(), webhookRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), body)
	if err != nil {
		return fmt.Errorf("build webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := vsockWebhookHTTPClient(target.Hostname()).Do(req)
	if err != nil {
		return fmt.Errorf("POST webhook: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("webhook returned %s: %s", resp.Status, respBody)
	}
	return nil
}

func vsockWebhookHTTPClient(host string) *http.Client {
	return &http.Client{
		Timeout: webhookRequestTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			DisableKeepAlives: true,
			DialTLSContext: func(ctx context.Context, _ string, _ string) (net.Conn, error) {
				conn, err := dialVsock(ctx, hostCID, webhookProxyPort)
				if err != nil {
					return nil, err
				}
				if err := conn.SetDeadline(time.Now().Add(tlsHandshakeTimeout)); err != nil {
					conn.Close()
					return nil, err
				}
				tlsConn := tls.Client(conn, &tls.Config{
					ServerName: host,
					MinVersion: tls.VersionTLS12,
				})
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
