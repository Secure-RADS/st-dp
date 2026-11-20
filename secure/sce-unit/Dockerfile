FROM golang:1.26-alpine AS build
WORKDIR /src/secure/sce-unit
RUN apk add --no-cache ca-certificates
COPY packages/go-common /src/packages/go-common
COPY secure/sce-unit/go.mod secure/sce-unit/go.sum ./
RUN go mod download
COPY secure/sce-unit/*.go ./
COPY secure/sce-unit/gen ./gen
RUN CGO_ENABLED=0 go build -o /sce-unit .

FROM scratch
COPY --from=build /sce-unit /sce-unit
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
