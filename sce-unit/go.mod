module sce-unit

go 1.25.0

require (
	github.com/aws/aws-sdk-go-v2/config v1.32.40
	github.com/aws/aws-sdk-go-v2/credentials v1.19.39
	github.com/aws/aws-sdk-go-v2/service/kms v1.56.0
	github.com/edgebitio/nitro-enclaves-sdk-go v1.0.0
	github.com/hf/nsm v0.0.0-20220930140112-cd181bd646b9
	github.com/mdlayher/vsock v1.3.0
	golang.org/x/sys v0.47.0
)

require (
	github.com/aws/aws-sdk-go-v2 v1.44.0 // indirect
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.18.40 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.4.40 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.7.40 // indirect
	github.com/aws/aws-sdk-go-v2/internal/v4a v1.4.41 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.13.19 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.13.40 // indirect
	github.com/aws/aws-sdk-go-v2/service/signin v1.6.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.34.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/ssooidc v1.39.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/sts v1.46.0 // indirect
	github.com/aws/smithy-go v1.28.1 // indirect
	github.com/fxamacker/cbor/v2 v2.4.0 // indirect
	github.com/mdlayher/socket v0.6.0 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	golang.org/x/net v0.55.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
)

replace github.com/aws/aws-sdk-go-v2/service/kms => github.com/edgebitio/nitro-enclaves-sdk-go/kms v0.0.0-20221110205443-8a5476ff3cc2
