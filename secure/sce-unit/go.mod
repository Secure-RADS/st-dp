module sce-unit

go 1.25.0

require (
	github.com/Secure-RADS/st-dp/packages/go-common v0.0.0
	github.com/aws/aws-sdk-go-v2/config v1.17.0
	github.com/aws/aws-sdk-go-v2/credentials v1.12.13
	github.com/aws/aws-sdk-go-v2/service/kms v1.16.7
	github.com/aws/aws-sdk-go-v2/service/sqs v1.19.5
	github.com/edgebitio/nitro-enclaves-sdk-go v1.0.0
	github.com/hf/nsm v0.0.0-20220930140112-cd181bd646b9
	github.com/mdlayher/vsock v1.3.0
	golang.org/x/sys v0.45.0
)

replace github.com/Secure-RADS/st-dp/packages/go-common => ../../packages/go-common

require (
	github.com/aws/aws-sdk-go-v2 v1.17.1 // indirect
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.12.19 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.1.25 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.4.19 // indirect
	github.com/aws/aws-sdk-go-v2/internal/ini v1.3.26 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.9.19 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.11.25 // indirect
	github.com/aws/aws-sdk-go-v2/service/sts v1.17.2 // indirect
	github.com/aws/smithy-go v1.13.4 // indirect
	github.com/fxamacker/cbor/v2 v2.4.0 // indirect
	github.com/mdlayher/socket v0.6.0 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	golang.org/x/net v0.55.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
)

replace github.com/aws/aws-sdk-go-v2/service/kms => github.com/edgebitio/nitro-enclaves-sdk-go/kms v0.0.0-20221110205443-8a5476ff3cc2
