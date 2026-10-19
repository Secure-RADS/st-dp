# Go common SDK

This module contains shared environment, cost-event, and timeline logging helpers for Go services in this repository. Cost and log reporting are best-effort and use the same JSON contracts and HTTPS endpoints as `packages/common`.

The `env` package reads required environment variables. The `cost` package defines cost phases, AWS services, operations, units, and the `/cost` event client. The `log` package defines build and execution event names and posts timeline events and subject-access records; callers can inject an `http.Client` to retain custom TLS transports.

Services depend on the module through a local `replace` directive. Docker builds that use it must use the repository root as their build context so `packages/go-common` is available.
