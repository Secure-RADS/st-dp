# eif_build has no prebuilt binary upstream (source-only releases on
# aws/aws-nitro-enclaves-image-format), so it's cargo-built here from a
# pinned tag. Kernel/init blobs come from the official aws-nitro-enclaves-cli
# package instead, since those are genuinely prebuilt by AWS.
FROM rust:1.94-alpine AS build
RUN apk add --no-cache musl-dev git openssl-dev openssl-libs-static pkgconfig
RUN git clone --branch v0.6.0 --depth 1 https://github.com/aws/aws-nitro-enclaves-image-format /src
WORKDIR /src
RUN cargo build --release -p eif_build

# Pinned to match the exact version the enclave host installs at boot
# (sce/execution-service/ec2.go's UserData) - the kernel/init blobs here
# and the enclave manager on the host talk a version-specific vsock
# protocol; a mismatch kills the boot handshake before the enclave ever
# gets a chance to run (observed as AWS's E36/E39 "ready signal" errors).
FROM amazonlinux:2023 AS blobs
RUN dnf install -y aws-nitro-enclaves-cli-devel-1.4.4-0.amzn2023 && \
    mkdir -p /opt/assets/eif && \
    cp /usr/share/nitro_enclaves/blobs/Image /opt/assets/eif/bzImage && \
    cp /usr/share/nitro_enclaves/blobs/Image.config /opt/assets/eif/bzImage.config && \
    cp /usr/share/nitro_enclaves/blobs/init /opt/assets/eif/nsm.cpio

FROM scratch
COPY --from=build /src/target/release/eif_build /opt/assets/eif/eif_build
COPY --from=blobs /opt/assets/eif/bzImage /opt/assets/eif/bzImage.config /opt/assets/eif/nsm.cpio /opt/assets/eif/
