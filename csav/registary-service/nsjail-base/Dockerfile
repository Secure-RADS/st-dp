# Compiles nsjail from source, once - per-upload builds COPY --from this image instead of recompiling nsjail every time.
FROM debian:bookworm-slim AS base

RUN apt-get -y update && apt-get install -y \
    libc6 \
    libstdc++6 \
    libprotobuf32 \
    libnl-route-3-200

FROM base AS build

RUN apt-get install -y \
    autoconf \
    bison \
    flex \
    gcc \
    g++ \
    git \
    libprotobuf-dev \
    libnl-route-3-dev \
    libtool \
    make \
    pkg-config \
    protobuf-compiler

RUN git clone --depth 1 https://github.com/google/nsjail.git /nsjail \
    && cd /nsjail && make

FROM base AS run
COPY --from=build /nsjail/nsjail /bin/nsjail
