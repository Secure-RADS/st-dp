FROM golang:1.25-alpine AS build
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -o /sce-unit .

FROM scratch
COPY --from=build /sce-unit /sce-unit
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
