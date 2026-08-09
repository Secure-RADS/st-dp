package main

import (
	"context"
	"net/http"
	"os"
	"path/filepath"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
)

var (
	s3Client       *s3.Client
	artifactBucket string
)

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	s3Client = s3.NewFromConfig(cfg)
	artifactBucket = os.Getenv("ARTIFACT_BUCKET")

	r := gin.Default()

	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "hello from registry-service")
	})

	r.POST("/upload", func(c *gin.Context) {
		if artifactBucket == "" {
			c.String(http.StatusInternalServerError, "ARTIFACT_BUCKET not configured")
			return
		}

		fileHeader, err := c.FormFile("image")
		if err != nil {
			c.String(http.StatusBadRequest, "missing 'image' form field: %v", err)
			return
		}

		uploadDir := "/tmp/registry-service-uploads"
		if err := os.MkdirAll(uploadDir, 0o750); err != nil {
			c.String(http.StatusInternalServerError, "could not create upload dir: %v", err)
			return
		}

		// filepath.Base strips any directory components a crafted
		// filename (e.g. containing "../") might carry.
		tmpPath := filepath.Join(uploadDir, filepath.Base(fileHeader.Filename))
		if err := c.SaveUploadedFile(fileHeader, tmpPath); err != nil {
			c.String(http.StatusInternalServerError, "could not stage upload: %v", err)
			return
		}
		defer os.Remove(tmpPath)

		builtKey, err := buildAndPush(c.Request.Context(), tmpPath)
		if err != nil {
			c.String(http.StatusInternalServerError, "build failed: %v", err)
			return
		}

		c.JSON(http.StatusOK, gin.H{"bucket": artifactBucket, "key": builtKey})
	})

	r.Run(":8080")
}
