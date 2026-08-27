package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
)

// provisionAlgorithmKmsKey creates one symmetric KMS key per algorithm whose key policy binds the
// enclave host role's Decrypt permission to this algorithm's EIF measurements (PCR0=ImageSha384, PCR1,
// PCR2). The result: only an enclave running the exact measured image can unwrap this algorithm's data
// keys - the host that holds the credentials cannot, and neither can an administrative principal.
// GenerateDataKey (for the ingest-time envelope) is granted to account root, but root is deliberately
// NOT given Decrypt, so even the key admin cannot decrypt the wrapped data keys.
func provisionAlgorithmKmsKey(ctx context.Context, algorithmId string, pcrs pcrMeasurements, enclaveHostRoleArn string) (string, error) {
	rootArn := "arn:aws:iam::" + accountFromArn(enclaveHostRoleArn) + ":root"
	keyPolicy, err := json.Marshal(map[string]any{
		"Version": "2012-10-17",
		"Statement": []map[string]any{
			{
				"Sid":       "RootManagementAndIngest",
				"Effect":    "Allow",
				"Principal": map[string]any{"AWS": rootArn},
				"Action": []string{
					"kms:CreateAlias", "kms:DeleteAlias", "kms:DescribeKey", "kms:EnableKeyRotation",
					"kms:GetKeyPolicy", "kms:GetKeyRotationStatus", "kms:ListAliases", "kms:ListResourceTags",
					"kms:ListRetirableGrants", "kms:PutKeyPolicy", "kms:RetireGrant", "kms:RevokeGrant",
					"kms:ScheduleKeyDeletion", "kms:TagResource", "kms:UntagResource", "kms:UpdateAlias",
					"kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:Encrypt",
				},
				"Resource": "*",
			},
			{
				"Sid":       "EnclaveOnlyDecrypt",
				"Effect":    "Allow",
				"Principal": map[string]any{"AWS": enclaveHostRoleArn},
				"Action":    "kms:Decrypt",
				"Resource":  "*",
				"Condition": map[string]any{
					"StringEqualsIgnoreCase": map[string]string{
						"kms:RecipientAttestation:ImageSha384": pcrs.PCR0,
						"kms:RecipientAttestation:PCR1":        pcrs.PCR1,
						"kms:RecipientAttestation:PCR2":        pcrs.PCR2,
					},
				},
			},
		},
	})
	if err != nil {
		return "", fmt.Errorf("marshal key policy: %w", err)
	}

	out, err := kmsClient.CreateKey(ctx, &kms.CreateKeyInput{
		Description: aws.String(fmt.Sprintf("enclave data key for algorithm %s", algorithmId)),
		KeyUsage:    types.KeyUsageTypeEncryptDecrypt,
		KeySpec:     types.KeySpecSymmetricDefault,
		Policy:      aws.String(string(keyPolicy)),
	})
	if err != nil {
		return "", fmt.Errorf("create KMS key: %w", err)
	}
	if out.KeyMetadata == nil {
		return "", fmt.Errorf("create KMS key: no key metadata")
	}
	return *out.KeyMetadata.Arn, nil
}

// accountFromArn pulls the AWS account id out of an IAM role ARN so the key policy can reference the
// account's root principal without an extra sts:GetCallerIdentity call or a hardcoded account id.
func accountFromArn(arn string) string {
	const prefix = "arn:aws:iam::"
	if len(arn) <= len(prefix) {
		return ""
	}
	rest := arn[len(prefix):]
	for i := 0; i < len(rest); i++ {
		if rest[i] == ':' {
			return rest[:i]
		}
	}
	return ""
}