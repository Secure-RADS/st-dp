# eif_build has no prebuilt binary upstream, so it's cargo-built from a pinned tag.
FROM rust:1.94-alpine AS build
RUN apk add --no-cache musl-dev git openssl-dev openssl-libs-static pkgconfig
RUN git clone --branch v0.6.0 --depth 1 https://github.com/aws/aws-nitro-enclaves-image-format /src
WORKDIR /src
RUN cargo build --release -p eif_build

# Version pinned to match the enclave host (sce/execution-service/ec2.go's UserData) -
# a mismatch fails the boot handshake with AWS's E36/E39 "ready signal" errors.
FROM amazonlinux:2023 AS blobs
# Bootstrap ramdisk must be a bootable cpio (/init, /nsm.ko, /dev), not the raw init ELF.
RUN set -o pipefail && \
    dnf install -y aws-nitro-enclaves-cli-devel-1.4.4-0.amzn2023 cpio findutils && \
    mkdir -p /opt/assets/eif /tmp/bootstrap/dev && \
    install -m 0755 /usr/share/nitro_enclaves/blobs/init /tmp/bootstrap/init && \
    install -m 0755 /usr/share/nitro_enclaves/blobs/nsm.ko /tmp/bootstrap/nsm.ko && \
    cd /tmp/bootstrap && find . -print0 | cpio --null -o --format=newc > /opt/assets/eif/bootstrap.cpio && \
    cp /usr/share/nitro_enclaves/blobs/Image /opt/assets/eif/Image && \
    cp /usr/share/nitro_enclaves/blobs/Image.config /opt/assets/eif/Image.config && \
    cp /usr/share/nitro_enclaves/blobs/cmdline /opt/assets/eif/cmdline

FROM scratch
COPY --from=build /src/target/release/eif_build /opt/assets/eif/eif_build
COPY --from=blobs /opt/assets/eif/Image /opt/assets/eif/Image.config /opt/assets/eif/bootstrap.cpio /opt/assets/eif/cmdline /opt/assets/eif/
