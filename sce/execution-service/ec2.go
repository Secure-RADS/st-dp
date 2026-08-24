package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"fmt"
	"text/template"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/aws/aws-sdk-go-v2/service/ec2/types"
)

//go:embed userdata.sh.tmpl
var userDataTmplText string

var userDataTmpl = template.Must(template.New("userdata.sh").Parse(userDataTmplText))

// c6g.large is 2 vCPU / 4GB total - reserve half for the enclave, leaving
// the rest for the host OS and nitro-cli itself.
const (
	enclaveCPUCount  = 1
	enclaveMemoryMiB = 2048
)

// launchEnclaveInstance starts a fresh Nitro-Enclave-capable EC2 instance and returns immediately -
// execution-service never connects to it directly, only receives its result callback.
func launchEnclaveInstance(ctx context.Context, s3Bucket, s3Key string) (string, error) {
	var userData bytes.Buffer
	err := userDataTmpl.Execute(&userData, struct {
		S3Bucket, S3Key, Region, CallbackURL string
		CPUCount, MemoryMiB                  int
	}{S3Bucket: s3Bucket, S3Key: s3Key, Region: awsRegion, CallbackURL: callbackURL, CPUCount: enclaveCPUCount, MemoryMiB: enclaveMemoryMiB})
	if err != nil {
		return "", fmt.Errorf("render user data: %w", err)
	}

	out, err := ec2Client.RunInstances(ctx, &ec2.RunInstancesInput{
		ImageId:      &enclaveAmiId,
		InstanceType: types.InstanceType(enclaveInstanceType),
		MinCount:     aws.Int32(1),
		MaxCount:     aws.Int32(1),
		SecurityGroupIds: []string{
			enclaveSecurityGroupId,
		},
		IamInstanceProfile: &types.IamInstanceProfileSpecification{
			Arn: &enclaveInstanceProfileArn,
		},
		EnclaveOptions: &types.EnclaveOptionsRequest{
			Enabled: aws.Bool(true),
		},
		UserData: aws.String(base64.StdEncoding.EncodeToString(userData.Bytes())),
		TagSpecifications: []types.TagSpecification{
			{
				ResourceType: types.ResourceTypeInstance,
				Tags: []types.Tag{
					{Key: aws.String("Name"), Value: aws.String("execution-service-run")},
					{Key: aws.String("ManagedBy"), Value: aws.String("execution-service")},
				},
			},
		},
	})
	if err != nil {
		return "", fmt.Errorf("run enclave instance: %w", err)
	}
	if len(out.Instances) == 0 {
		return "", fmt.Errorf("run enclave instance: no instance returned")
	}

	return *out.Instances[0].InstanceId, nil
}
