FROM golang:1.25-alpine AS build
WORKDIR /src/secure-rads/sce-unit
RUN apk add --no-cache ca-certificates
COPY packages/go-common /src/packages/go-common
COPY secure-rads/sce-unit/go.mod secure-rads/sce-unit/go.sum ./
RUN go mod download
COPY secure-rads/sce-unit/*.go ./
RUN CGO_ENABLED=0 go build -o /sce-unit .

FROM scratch
COPY --from=build /sce-unit /sce-unit
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
