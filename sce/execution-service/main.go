package main

import (
	"context"
	"net/http"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

var (
	dynamoClient       *dynamodb.Client
	dynamoTable        string
	ec2Client          *ec2.Client
	awsRegion          string
	verifierHost       string
	pdmHost            string
	logHost            string
	runResultsQueueURL string
	runResultsTable    string

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
	verifierHost = os.Getenv("VERIFIER_HOST")
	pdmHost = os.Getenv("PDM_HOST")
	logHost = os.Getenv("LOG_HOST")
	runResultsQueueURL = os.Getenv("RUN_RESULTS_QUEUE_URL")
	runResultsTable = os.Getenv("RUN_RESULTS_TABLE")

	enclaveAmiId = os.Getenv("ENCLAVE_AMI_ID")
	enclaveInstanceType = os.Getenv("ENCLAVE_INSTANCE_TYPE")
	enclaveSecurityGroupId = os.Getenv("ENCLAVE_SECURITY_GROUP_ID")
	enclaveInstanceProfileArn = os.Getenv("ENCLAVE_INSTANCE_PROFILE_ARN")

	r := gin.Default()

	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "hello from execution-service")
	})

	// Fire-and-forget: launch the enclave and return a runId immediately. The enclave host posts its result to
	// SQS, a consumer Lambda writes it to the RunResults table, and the caller polls GET /run/:runId.
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

		runId := uuid.NewString()
		logEvent(req.AlgorithmId, runId, eventRunRequested, nil)

		instanceId, err := launchEnclaveInstance(c.Request.Context(), rec.S3Bucket, rec.S3Key, req.AlgorithmId, runId)
		if err != nil {
			logEvent(req.AlgorithmId, runId, eventLaunchFailed, map[string]any{"error": err.Error()})
			c.String(http.StatusInternalServerError, "launch failed: %v", err)
			return
		}
		logEvent(req.AlgorithmId, runId, eventEnclaveLaunched, map[string]any{"instanceId": instanceId})

		c.JSON(http.StatusAccepted, gin.H{
			"runId":       runId,
			"algorithmId": req.AlgorithmId,
			"instanceId":  instanceId,
			"status":      "pending",
		})
	})

	// Poll for a run's result. Absent from the table means the run hasn't reported back yet (or the runId is
	// unknown - execution-service doesn't track launched runs once they're fire-and-forget).
	r.GET("/run/:runId", func(c *gin.Context) {
		res, found, err := getRunResult(c.Request.Context(), c.Param("runId"))
		if err != nil {
			c.String(http.StatusInternalServerError, "result lookup failed: %v", err)
			return
		}
		if !found {
			c.JSON(http.StatusOK, gin.H{"runId": c.Param("runId"), "status": "pending"})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	r.Run(":8080")
}
