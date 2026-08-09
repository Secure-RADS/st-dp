FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go nsjail.cfg.tmpl ./
RUN CGO_ENABLED=0 go build -o /registry-service .

FROM alpine:3.20
RUN apk add --no-cache buildah bash
COPY --from=build /registry-service /registry-service
EXPOSE 8080
ENTRYPOINT ["/registry-service"]
