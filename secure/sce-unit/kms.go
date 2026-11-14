package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
	enclave "github.com/edgebitio/nitro-enclaves-sdk-go"
)

// The host runs a vsock-proxy that forwards port 8000 to kms.<region>.amazonaws.com:443 (see
// userdata.sh.tmpl). The KMS client dials that proxy over vsock; TLS terminates against the real KMS
// endpoint through the relay.
const kmsProxyPort = 8000

const kmsRequestTimeout = 30 * time.Second

// decryptDataKey unwraps an envelope data key that KMS returned, via a Decrypt call carrying this
// enclave's attestation document. KMS only returns the key (wrapped to the enclave's ephemeral public
// key) when the attestation's PCRs match the key policy's kms:RecipientAttestation conditions - so only
// the measured enclave can obtain the plaintext data key.
func decryptDataKey(cfg runConfig, creds awsCreds, encDataKey []byte) ([]byte, error) {
	handle, err := enclave.GetOrInitializeHandle()
	if err != nil {
		return nil, fmt.Errorf("initialize enclave handle: %w", err)
	}
	attestationDocument, err := handle.Attest(enclave.AttestationOptions{})
	if err != nil {
		return nil, fmt.Errorf("request attestation document: %w", err)
	}

	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(cfg.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			creds.AccessKeyId, creds.SecretAccessKey, creds.SessionToken)),
		config.WithHTTPClient(vsockKMSHTTPClient(cfg.Region)),
	)
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	kmsClient := kms.NewFromConfig(awsCfg)

	ctx, cancel := context.WithTimeout(context.Background(), kmsRequestTimeout)
	defer cancel()
	res, err := kmsClient.Decrypt(ctx, &kms.DecryptInput{
		CiphertextBlob: encDataKey,
		Recipient: &types.RecipientInfoType{
			AttestationDocument:    attestationDocument,
			KeyEncryptionAlgorithm: types.EncryptionAlgorithmSpecRsaesOaepSha256,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("kms decrypt: %w", err)
	}
	if res.CiphertextForRecipient == nil {
		return nil, fmt.Errorf("kms decrypt: no CiphertextForRecipient returned")
	}
	key, err := handle.DecryptKMSEnvelopedKey(res.CiphertextForRecipient)
	if err != nil {
		return nil, fmt.Errorf("unwrap KMS recipient payload: %w", err)
	}
	return key, nil
}

// vsockKMSHTTPClient routes KMS HTTP/TLS through the host's vsock-proxy instead of real TCP - the enclave
// has no network. TLS still verifies the real KMS endpoint cert through the relay.
func vsockKMSHTTPClient(region string) *http.Client {
	return vsockAWSEndpointHTTPClient(fmt.Sprintf("kms.%s.amazonaws.com", region), kmsProxyPort)
}
