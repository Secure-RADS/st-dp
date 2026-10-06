# Host-side helpers for the per-run EC2 executor (linux/arm64 for c6g).
# Ship once to the images bucket; userdata downloads before executor-ready.
TOOLS_BIN ?= rads-host-tools
TOOLS_S3_BUCKET ?= rads-images
TOOLS_S3_KEY ?= executor/rads-host-tools
DIST ?= dist/$(TOOLS_BIN)

.PHONY: build ship

build:
	mkdir -p dist
	cd host-tools && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o ../$(DIST) .

ship: build
	aws s3 cp $(DIST) s3://$(TOOLS_S3_BUCKET)/$(TOOLS_S3_KEY)
