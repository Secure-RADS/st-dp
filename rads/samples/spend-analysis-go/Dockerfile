FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /spend-analysis .
RUN apk add --no-cache ca-certificates

FROM scratch
COPY --from=build /spend-analysis /spend-analysis
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENV PATH="/"
ENTRYPOINT ["/spend-analysis"]