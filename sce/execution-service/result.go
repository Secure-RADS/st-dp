package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// The enclave host has no inbound path, so its run status and the DC app's
// output arrive as objects under runs/<instance-id>/ in the artifact bucket.
const (
	resultPollInterval = 5 * time.Second
	resultTimeout      = 10 * time.Minute
)

type runResult struct {
	Status string
	Output string
}

// waitForResult blocks until the host has written status.txt (its last act
// before self-terminating), then reads the output the enclave sent, if any.
func waitForResult(ctx context.Context, instanceId string) (*runResult, error) {
	prefix := "runs/" + instanceId + "/"
	deadline := time.Now().Add(resultTimeout)
	for {
		status, err := getObject(ctx, prefix+"status.txt")
		if err == nil {
			output, oerr := getObject(ctx, prefix+"output.txt")
			if oerr != nil && !isNotFound(oerr) {
				return nil, fmt.Errorf("read output: %w", oerr)
			}
			return &runResult{Status: strings.TrimSpace(status), Output: output}, nil
		}
		if !isNotFound(err) {
			return nil, fmt.Errorf("read status: %w", err)
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("timed out after %s waiting for %s", resultTimeout, prefix+"status.txt")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(resultPollInterval):
		}
	}
}

func getObject(ctx context.Context, key string) (string, error) {
	out, err := s3Client.GetObject(ctx, &s3.GetObjectInput{Bucket: &artifactBucket, Key: &key})
	if err != nil {
		return "", err
	}
	defer out.Body.Close()
	b, err := io.ReadAll(out.Body)
	return string(b), err
}

func isNotFound(err error) bool {
	var nsk *types.NoSuchKey
	return errors.As(err, &nsk)
}
