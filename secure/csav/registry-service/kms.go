package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

func algorithmKeyDescription(algorithmId string) string {
	return fmt.Sprintf("enclave data key for algorithm %s", algorithmId)
}

// ensureAlgorithmKmsKey returns the algorithm's PCR-bound KMS key. It creates the key on first build and reuses
// the existing one on rebuild, rewriting the policy to the new measurements, so a build never orphans a key.
func ensureAlgorithmKmsKey(ctx context.Context, algorithmId string, pcrs pcrMeasurements, existingKeyArn, kmsServiceRoleArn, csavRoleArn string) (string, error) {
	policy, err := algorithmKeyPolicy(ctx, pcrs, kmsServiceRoleArn, csavRoleArn)
	if err != nil {
		return "", err
	}

	if existingKeyArn != "" {
		reusable, err := reusableAlgorithmKey(ctx, existingKeyArn, algorithmId)
		if err != nil {
			return "", err
		}
		if reusable {
			if _, err := kmsClient.PutKeyPolicy(ctx, &kms.PutKeyPolicyInput{
				KeyId:      aws.String(existingKeyArn),
				PolicyName: aws.String("default"),
				Policy:     aws.String(policy),
			}); err != nil {
				return "", fmt.Errorf("update KMS key policy: %w", err)
			}
			return existingKeyArn, nil
		}
	}

	out, err := kmsClient.CreateKey(ctx, &kms.CreateKeyInput{
		Description: aws.String(algorithmKeyDescription(algorithmId)),
		KeyUsage:    types.KeyUsageTypeEncryptDecrypt,
		KeySpec:     types.KeySpecSymmetricDefault,
		Policy:      aws.String(policy),
	})
	if err != nil {
		return "", fmt.Errorf("create KMS key: %w", err)
	}
	if out.KeyMetadata == nil {
		return "", fmt.Errorf("create KMS key: no key metadata")
	}
	return *out.KeyMetadata.Arn, nil
}

// reusableAlgorithmKey reports whether keyArn is this algorithm's Enabled key and can have its policy rewritten.
// A description that does not match is refused, so the artifact bucket key (or any other key the row points at)
// is never touched; a key that is missing or already scheduled for deletion is simply not reusable, and the
// caller creates a fresh one.
func reusableAlgorithmKey(ctx context.Context, keyArn, algorithmId string) (bool, error) {
	out, err := kmsClient.DescribeKey(ctx, &kms.DescribeKeyInput{KeyId: aws.String(keyArn)})
	if err != nil {
		var notFound *types.NotFoundException
		if errors.As(err, &notFound) {
			return false, nil
		}
		return false, fmt.Errorf("describe existing KMS key: %w", err)
	}
	meta := out.KeyMetadata
	if meta == nil {
		return false, nil
	}
	if aws.ToString(meta.Description) != algorithmKeyDescription(algorithmId) {
		return false, fmt.Errorf("refusing to reuse KMS key %s: description is not %q", keyArn, algorithmKeyDescription(algorithmId))
	}
	return meta.KeyState == types.KeyStateEnabled, nil
}

// algorithmKeyPolicy binds Decrypt to the EIF measurements. Only the matching enclave can unwrap this
// algorithm's data keys; the host and key administrators cannot.
func algorithmKeyPolicy(ctx context.Context, pcrs pcrMeasurements, kmsServiceRoleArn, csavRoleArn string) (string, error) {
	identity, err := stsClient.GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		return "", fmt.Errorf("get AWS account identity: %w", err)
	}
	if identity.Account == nil || *identity.Account == "" {
		return "", fmt.Errorf("get AWS account identity: missing account")
	}
	rootArn := "arn:aws:iam::" + *identity.Account + ":root"
	policy, err := json.Marshal(map[string]any{
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
				// kms-service calls Decrypt on the enclave's behalf and forwards its attestation document as
				// the Recipient, so the attested measurements below still gate access and kms-service only
				// ever receives ciphertext addressed to the enclave.
				"Sid":       "KmsServiceDecrypt",
				"Effect":    "Allow",
				"Principal": map[string]any{"AWS": kmsServiceRoleArn},
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
	return string(policy), nil
}
