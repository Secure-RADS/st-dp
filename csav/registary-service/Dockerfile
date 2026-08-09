# nsjail-base and sce-unit-base must already exist in the local image cache
# before building this (see their own Makefiles/Dockerfiles) - both are
# pre-built assets baked in here, never rebuilt per upload.
FROM nsjail-base:latest AS nsjail
FROM sce-unit-base:latest AS sceunit

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go nsjail.cfg.tmpl ./
RUN CGO_ENABLED=0 go build -o /registry-service .

FROM alpine:3.20
RUN apk add --no-cache skopeo umoci
COPY --from=nsjail / /opt/assets/nsjail-runtime/
COPY --from=sceunit /sce-unit /opt/assets/sce-unit
COPY --from=build /registry-service /registry-service
EXPOSE 8080
ENTRYPOINT ["/registry-service"]
