FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum main.go ./
COPY gen ./gen
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /spend-analysis .

FROM scratch
COPY --from=build /spend-analysis /spend-analysis

ENV PATH="/"
ENTRYPOINT ["/spend-analysis"]
