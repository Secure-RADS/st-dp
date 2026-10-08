package main

import (
	"context"
	"io"

	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const s3PartBytes = 5 * 1024 * 1024

// s3PutRequests approximates the S3 PUT requests for an object: the uploader switches to multipart above its
// 5 MiB threshold, and each part is billed as a request.
func s3PutRequests(size int64) float64 {
	if size <= s3PartBytes {
		return 1
	}
	return float64((size + s3PartBytes - 1) / s3PartBytes)
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
