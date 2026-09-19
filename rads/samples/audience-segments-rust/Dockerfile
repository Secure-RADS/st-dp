FROM rust:1-alpine AS build
WORKDIR /src
RUN apk add --no-cache musl-dev ca-certificates
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked && cp target/release/audience-segments /audience-segments

FROM scratch
COPY --from=build /audience-segments /audience-segments
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENV PATH="/"
ENTRYPOINT ["/audience-segments"]