FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /spend-analysis .

FROM scratch
COPY --from=build /spend-analysis /spend-analysis

ENV PATH="/"
ENTRYPOINT ["/spend-analysis"]
