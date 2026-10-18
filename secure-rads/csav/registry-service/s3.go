package main

import (
	"context"
	"io"

	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const s3PartBytes = 5 * 1024 * 1024

// Count multipart initiation, part uploads, and completion as billable S3 PUT requests.
func s3PutRequests(size int64) float64 {
	if size <= s3PartBytes {
		return 1
	}
	return float64(2 + (size+s3PartBytes-1)/s3PartBytes)
}

func uploadToS3(ctx context.Context, key string, body io.Reader) error {
	uploader := manager.NewUploader(s3Client)
	_, err := uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: &artifactBucket,
		Key:    &key,
		Body:   body,
	})
	return err
}
