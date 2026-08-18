# eif_build has no prebuilt binary upstream (source-only releases on
# aws/aws-nitro-enclaves-image-format), so it's cargo-built here from a
# pinned tag. Kernel/init blobs come from the official aws-nitro-enclaves-cli
# package instead, since those are genuinely prebuilt by AWS.
FROM rust:1.94-alpine AS build
RUN apk add --no-cache musl-dev git openssl-dev openssl-libs-static pkgconfig
RUN git clone --branch v0.6.0 --depth 1 https://github.com/aws/aws-nitro-enclaves-image-format /src
WORKDIR /src
RUN cargo build --release -p eif_build

FROM amazonlinux:2023 AS blobs
RUN dnf install -y aws-nitro-enclaves-cli-devel && \
    mkdir -p /opt/assets/eif && \
    cp /usr/share/nitro_enclaves/blobs/Image /opt/assets/eif/bzImage && \
    cp /usr/share/nitro_enclaves/blobs/Image.config /opt/assets/eif/bzImage.config && \
    cp /usr/share/nitro_enclaves/blobs/init /opt/assets/eif/nsm.cpio

FROM scratch
COPY --from=build /src/target/release/eif_build /opt/assets/eif/eif_build
COPY --from=blobs /opt/assets/eif/bzImage /opt/assets/eif/bzImage.config /opt/assets/eif/nsm.cpio /opt/assets/eif/
