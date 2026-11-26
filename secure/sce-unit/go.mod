module sce-unit

go 1.25.0

require (
	github.com/Secure-RADS/st-dp/packages/go-common v0.0.0
	github.com/edgebitio/nitro-enclaves-sdk-go v1.0.0
	github.com/hf/nsm v0.0.0-20220930140112-cd181bd646b9
	github.com/mdlayher/vsock v1.3.0
	golang.org/x/sys v0.45.0
)

replace github.com/Secure-RADS/st-dp/packages/go-common => ../../packages/go-common

require (
	github.com/fxamacker/cbor/v2 v2.4.0 // indirect
	github.com/mdlayher/socket v0.6.0 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	golang.org/x/net v0.55.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
)
