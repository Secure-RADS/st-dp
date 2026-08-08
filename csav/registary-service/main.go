package main

import (
	"context"
	"net/http"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	s3Client := s3.NewFromConfig(cfg)
	bucket := os.Getenv("ARTIFACT_BUCKET")

	r := gin.Default()

	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "hello from registry-service")
	})

	r.POST("/upload", func(c *gin.Context) {
		if bucket == "" {
			c.String(http.StatusInternalServerError, "ARTIFACT_BUCKET not configured")
			return
		}

		fileHeader, err := c.FormFile("image")
		if err != nil {
			c.String(http.StatusBadRequest, "missing 'image' form field: %v", err)
			return
		}

		file, err := fileHeader.Open()
		if err != nil {
			c.String(http.StatusInternalServerError, "could not open upload: %v", err)
			return
		}
		defer file.Close()

		key := fileHeader.Filename
		_, err = s3Client.PutObject(c.Request.Context(), &s3.PutObjectInput{
			Bucket: &bucket,
			Key:    &key,
			Body:   file,
		})
		if err != nil {
			c.String(http.StatusInternalServerError, "s3 upload failed: %v", err)
			return
		}

		c.JSON(http.StatusOK, gin.H{"bucket": bucket, "key": key})
	})

	r.Run(":8080")
}
