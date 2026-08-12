FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -o /execution-service .

FROM alpine:3.20
COPY --from=build /execution-service /execution-service
EXPOSE 8080
ENTRYPOINT ["/execution-service"]
