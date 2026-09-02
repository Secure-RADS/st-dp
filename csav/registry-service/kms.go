package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

// provisionAlgorithmKmsKey creates a KMS key whose Decrypt permission is bound to the EIF measurements.
// Only the matching enclave can unwrap this algorithm's data keys; the host and key administrators cannot.
func provisionAlgorithmKmsKey(ctx context.Context, algorithmId string, pcrs pcrMeasurements, enclaveHostRoleArn, csavRoleArn string) (string, error) {
	identity, err := stsClient.GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		return "", fmt.Errorf("get AWS account identity: %w", err)
	}
	if identity.Account == nil || *identity.Account == "" {
		return "", fmt.Errorf("get AWS account identity: missing account")
	}
	rootArn := "arn:aws:iam::" + *identity.Account + ":root"
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
				// The CSAV role calls CreateKey, so KMS requires it to retain the ability to manage the key
				// (PutKeyPolicy) or the call fails. Management only - it still cannot Decrypt.
				"Sid":       "CsavRoleManagement",
				"Effect":    "Allow",
				"Principal": map[string]any{"AWS": csavRoleArn},
				"Action": []string{
					"kms:DescribeKey", "kms:GetKeyPolicy", "kms:PutKeyPolicy", "kms:GetKeyRotationStatus",
					"kms:EnableKeyRotation", "kms:ScheduleKeyDeletion", "kms:TagResource", "kms:UntagResource",
					"kms:CreateAlias", "kms:DeleteAlias", "kms:UpdateAlias", "kms:ListAliases",
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
