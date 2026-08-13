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
	dynamoClient *dynamodb.Client
	dynamoTable  string
	ec2Client    *ec2.Client
	awsRegion    string

	enclaveAmiId              string
	enclaveInstanceType       string
	enclaveSecurityGroupId    string
	enclaveInstanceProfileArn string
	verifierDomain            string
	pdmsDomain                string
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

	enclaveAmiId = os.Getenv("ENCLAVE_AMI_ID")
	enclaveInstanceType = os.Getenv("ENCLAVE_INSTANCE_TYPE")
	enclaveSecurityGroupId = os.Getenv("ENCLAVE_SECURITY_GROUP_ID")
	enclaveInstanceProfileArn = os.Getenv("ENCLAVE_INSTANCE_PROFILE_ARN")
	verifierDomain = os.Getenv("VERIFIER_DOMAIN")
	pdmsDomain = os.Getenv("PDMS_DOMAIN")

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

		instanceId, err := launchEnclaveInstance(c.Request.Context(), rec.S3Bucket, rec.S3Key)
		if err != nil {
			c.String(http.StatusInternalServerError, "launch failed: %v", err)
			return
		}

		c.JSON(http.StatusAccepted, gin.H{"algorithmId": req.AlgorithmId, "instanceId": instanceId})
	})

	r.Run(":8080")
}
