module sce-unit

go 1.26.0

require (
	github.com/Secure-RADS/st-dp/packages/go-common v0.0.0
	github.com/edgebitio/nitro-enclaves-sdk-go v1.0.0
	github.com/hf/nsm v0.0.0-20220930140112-cd181bd646b9
	github.com/mdlayher/vsock v1.3.0
	golang.org/x/sys v0.48.0
	google.golang.org/grpc v1.85.0
	google.golang.org/protobuf v1.36.12
)

replace github.com/Secure-RADS/st-dp/packages/go-common => ../../packages/go-common

require (
	github.com/fxamacker/cbor/v2 v2.4.0 // indirect
	github.com/mdlayher/socket v0.6.0 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	golang.org/x/net v0.60.0 // indirect
	golang.org/x/sync v0.23.0 // indirect
	golang.org/x/text v0.42.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260817212433-ac3dfec99bb1 // indirect
)
