package main

import (
	"context"
	"net/http"
	"os"
	"path/filepath"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

var (
	s3Client           *s3.Client
	artifactBucket     string
	dynamoClient       *dynamodb.Client
	dynamoTable        string
	kmsClient          *kms.Client
	stsClient          *sts.Client
	enclaveHostRoleArn string
)

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	s3Client = s3.NewFromConfig(cfg)
	artifactBucket = os.Getenv("ARTIFACT_BUCKET")
	dynamoClient = dynamodb.NewFromConfig(cfg)
	dynamoTable = os.Getenv("DYNAMO_TABLE")
	kmsClient = kms.NewFromConfig(cfg)
	stsClient = sts.NewFromConfig(cfg)
	enclaveHostRoleArn = os.Getenv("ENCLAVE_HOST_ROLE_ARN")
	csavRoleArn = os.Getenv("CSAV_ROLE_ARN")

	r := gin.Default()

	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "hello from registry-service")
	})

	r.POST("/upload", func(c *gin.Context) {
		if artifactBucket == "" {
			c.String(http.StatusInternalServerError, "ARTIFACT_BUCKET not configured")
			return
		}
		if dynamoTable == "" {
			c.String(http.StatusInternalServerError, "DYNAMO_TABLE not configured")
			return
		}

		fileHeader, err := c.FormFile("image")
		if err != nil {
			c.String(http.StatusBadRequest, "missing 'image' form field: %v", err)
			return
		}

		// The caller assigns the algorithmId so the EIF binds to the same id its dataset was seeded under in
		// the PDM table - server-generated ids could never line up with pre-seeded data.
		algorithmId := c.PostForm("algorithmId")
		if _, err := uuid.Parse(algorithmId); err != nil {
			c.String(http.StatusBadRequest, "missing or invalid 'algorithmId' form field (must be a UUID): %v", err)
			return
		}

		// buildId is the runId under which this build's log timeline and cost rows are recorded.
		buildId := uuid.NewString()

		uploadDir := "/tmp/registry-service-uploads"
		// 0o755: standard dir perms - MkdirAll requires a mode, no bare option.
		if err := os.MkdirAll(uploadDir, 0o755); err != nil {
			c.String(http.StatusInternalServerError, "could not create upload dir: %v", err)
			return
		}

		tmpPath := filepath.Join(uploadDir, algorithmId+".tar")
		if err := c.SaveUploadedFile(fileHeader, tmpPath); err != nil {
			c.String(http.StatusInternalServerError, "could not stage upload: %v", err)
			return
		}
		defer os.Remove(tmpPath)

		existing, found, err := getAlgorithm(c.Request.Context(), algorithmId, buildId)
		if err != nil {
			c.String(http.StatusInternalServerError, "could not read algorithm: %v", err)
			return
		}
		existingKmsKeyArn := ""
		if found {
			existingKmsKeyArn = existing.KmsKeyArn
		}

		builtKey, err := buildAndPush(c.Request.Context(), algorithmId, tmpPath, existingKmsKeyArn, buildId)
		if err != nil {
			c.String(http.StatusInternalServerError, "build failed: %v", err)
			return
		}

		c.JSON(http.StatusOK, gin.H{"algorithmId": algorithmId, "bucket": artifactBucket, "key": builtKey})
	})

	r.Run(":8080")
}
