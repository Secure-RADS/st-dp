package main

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/aws/aws-sdk-go-v2/service/ec2/types"
)

// c6g.large is 2 vCPU / 4GB total - reserve half for the enclave, leaving
// the rest for the host OS and nitro-cli itself.
const (
	enclaveCPUCount  = 1
	enclaveMemoryMiB = 2048
)

// Fixed vsock port sce-unit dials (CID 3 = parent instance) to reach
// verifier-service through the outbound-only vsock-proxy tunnel - the
// enclave has no direct network access at all.
const verifierProxyVsockPort = 8000

// launchEnclaveInstance starts a fresh Nitro-Enclave-capable EC2 instance
// that downloads the given EIF from S3, runs it, and terminates itself once
// the enclave process exits - execution-service never connects to it
// directly (its security group has no ingress at all).
func launchEnclaveInstance(ctx context.Context, s3Bucket, s3Key string) (string, error) {
	userData := fmt.Sprintf(`#!/bin/bash
set -uo pipefail
exec > >(tee /var/log/execution-service-run.log) 2>&1

# Always self-terminate on exit, success or failure - otherwise a failed
# step (e.g. the enclave failing to boot) leaves this instance running
# indefinitely, since execution-service never connects to it directly to
# find out what happened. Also uploads a status marker + full log to S3,
# since console output is unreliable to poll (delayed/cleared on terminate)
# and this instance has no other way to report back what happened.
finish() {
  STATUS=$?
  TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
  INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
  REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
  echo "exit:$STATUS" > /tmp/status.txt
  aws s3 cp /tmp/status.txt "s3://%s/runs/$INSTANCE_ID/status.txt" --region "$REGION" || true
  aws s3 cp /var/log/execution-service-run.log "s3://%s/runs/$INSTANCE_ID/log.txt" --region "$REGION" || true
  aws s3 sync /var/log/nitro_enclaves/ "s3://%s/runs/$INSTANCE_ID/nitro_enclaves_logs/" --region "$REGION" || true
  aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
}
trap finish EXIT

# Version pinned to match eif-build/Dockerfile exactly - the kernel/init
# blobs baked into the EIF and this host's enclave manager talk a
# version-specific vsock protocol, so they must be built from the same
# aws-nitro-enclaves-cli-devel release or the boot handshake fails silently.
dnf install -y aws-nitro-enclaves-cli-1.4.4-0.amzn2023 aws-nitro-enclaves-cli-devel-1.4.4-0.amzn2023 awscli

cat > /etc/nitro_enclaves/allocator.yaml <<EOF
---
memory_mib: %d
cpu_count: %d
EOF
systemctl enable --now nitro-enclaves-allocator

# vsock-proxy requires the destination in its allowlist config, even when
# passed as CLI args - the enclave has no direct network access, so this is
# the only path for sce-unit's mTLS call to verifier-service.
cat > /tmp/vsock-proxy-verifier.yaml <<EOF
allowlist:
  - {address: %s, port: 443}
EOF
vsock-proxy %d %s 443 --config /tmp/vsock-proxy-verifier.yaml &

mkdir -p /opt/eif
aws s3 cp "s3://%s/%s" /opt/eif/app.eif --region "%s"

nitro-cli run-enclave --cpu-count %d --memory %d --eif-path /opt/eif/app.eif --enclave-cid 16

while nitro-cli describe-enclaves | grep -q '"EnclaveID"'; do
  sleep 5
done
`, s3Bucket, s3Bucket, s3Bucket, enclaveMemoryMiB, enclaveCPUCount, verifierDomain, verifierProxyVsockPort, verifierDomain, s3Bucket, s3Key, awsRegion, enclaveCPUCount, enclaveMemoryMiB)

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
		UserData: aws.String(base64.StdEncoding.EncodeToString([]byte(userData))),
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
