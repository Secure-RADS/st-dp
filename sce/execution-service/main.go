package main

import (
	"context"
	"net/http"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/gin-gonic/gin"
)

var (
	dynamoClient         *dynamodb.Client
	dynamoTable          string
	ec2Client            *ec2.Client
	awsRegion            string
	callbackURL          string
	verifierHost         string
	verifierPubKeySHA256 string

	enclaveAmiId              string
	enclaveInstanceType       string
	enclaveSecurityGroupId    string
	enclaveInstanceProfileArn string
)

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(err)
	}
	dynamoClient = dynamodb.NewFromConfig(cfg)
	dynamoTable = os.Getenv("ALGORITHM_TABLE")
	ec2Client = ec2.NewFromConfig(cfg)
	awsRegion = os.Getenv("AWS_REGION")
	callbackURL = os.Getenv("CALLBACK_URL")
	verifierHost = os.Getenv("VERIFIER_HOST")
	verifierPubKeySHA256 = os.Getenv("VERIFIER_PUBKEY_SHA256")

	enclaveAmiId = os.Getenv("ENCLAVE_AMI_ID")
	enclaveInstanceType = os.Getenv("ENCLAVE_INSTANCE_TYPE")
	enclaveSecurityGroupId = os.Getenv("ENCLAVE_SECURITY_GROUP_ID")
	enclaveInstanceProfileArn = os.Getenv("ENCLAVE_INSTANCE_PROFILE_ARN")

	r := gin.Default()

	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "hello from execution-service")
	})

	r.POST("/run", func(c *gin.Context) {
		var req struct {
			AlgorithmId string `json:"algorithmId" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.String(http.StatusBadRequest, "invalid request: %v", err)
			return
		}

		rec, err := getAlgorithm(c.Request.Context(), req.AlgorithmId)
		if err != nil {
			c.String(http.StatusNotFound, "algorithm lookup failed: %v", err)
			return
		}

		instanceId, err := launchEnclaveInstance(c.Request.Context(), req.AlgorithmId, rec.S3Bucket, rec.S3Key)
		if err != nil {
			c.String(http.StatusInternalServerError, "launch failed: %v", err)
			return
		}

		ch := registerRun(instanceId)
		defer unregisterRun(instanceId)

		// Synchronous by design for now: the caller holds the request until the
		// enclave has run and its output is back, so one curl shows the whole loop.
		result, err := waitForResult(c.Request.Context(), instanceId, ch)
		if err != nil {
			c.String(http.StatusGatewayTimeout, "run %s on %s: %v", req.AlgorithmId, instanceId, err)
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"algorithmId": req.AlgorithmId,
			"instanceId":  instanceId,
			"status":      result.Status,
			"output":      result.Output,
		})
	})

	// Called by the enclave host (same VPC) right before it self-terminates.
	r.POST("/result/:instanceId", func(c *gin.Context) {
		var res runResult
		if err := c.ShouldBindJSON(&res); err != nil {
			c.String(http.StatusBadRequest, "invalid result: %v", err)
			return
		}
		if !deliverResult(c.Param("instanceId"), res) {
			c.String(http.StatusNotFound, "no pending run for %s", c.Param("instanceId"))
			return
		}
		c.Status(http.StatusNoContent)
	})

	r.Run(":8080")
}
