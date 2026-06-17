# Build the AWS libnsm shared library used by the enclave to talk to /dev/nsm.
# The enclave binds the AWS libnsm C API via ctypes, so the library must be
# present in the image.
FROM rust:1-slim AS libnsm
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/aws/aws-nitro-enclaves-nsm-api.git . \
    && cargo build --release -p nsm-lib

FROM python:3.12-slim AS runtime

WORKDIR /app

# Runtime needs cbor2 for the NSM CBOR exchange; install the package itself.
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

COPY --from=libnsm /src/target/release/libnsm.so /usr/lib/libnsm.so

ENV VSOCK_PORT=5000

ENTRYPOINT ["nitro-enclave"]
