# nsjail pinned by digest; sce-unit-base must be built locally first (see Makefile).
FROM ghcr.io/prdai/nsjail-docker@sha256:6c500a51d3ccadf2fb8fb312c2738aa1a6ba867a3982c0d206478c6a7edec35b AS nsjail
FROM sce-unit-base:latest AS sceunit
# eif-build-base must be built locally first (see Makefile) - not pushed to GHCR yet.
FROM eif-build-base:latest AS eifassets

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go nsjail.cfg.tmpl ./
RUN CGO_ENABLED=0 go build -o /registry-service .

FROM alpine:3.20
RUN apk add --no-cache skopeo umoci cpio
COPY --from=nsjail / /opt/assets/nsjail-runtime/
COPY --from=sceunit /sce-unit /opt/assets/sce-unit
COPY --from=eifassets /opt/assets/eif /opt/assets/eif
COPY tls/client.crt tls/client.key /opt/assets/tls/
COPY sce-tls/client.crt sce-tls/client.key /opt/assets/sce-tls/
COPY --from=build /registry-service /registry-service
EXPOSE 8080
ENTRYPOINT ["/registry-service"]
