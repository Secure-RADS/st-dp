FROM rust:1-alpine AS build
WORKDIR /src
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked && cp target/release/audience-segments /audience-segments

FROM scratch
COPY --from=build /audience-segments /audience-segments

ENV PATH="/"
ENTRYPOINT ["/audience-segments"]
