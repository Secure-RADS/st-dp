# RADS

This repository contains RADS and Secure-RADS. RADS is reserved for its future implementation. Secure-RADS is a PoC of the Secure Computing Environment (SCE) on AWS Nitro Enclaves. A Data Controller's algorithm runs inside an attested enclave over a data subject's personal data, so the data is processed without the Data Controller ever seeing it.

## The two phases

**Build phase (CSAV).** A Data Controller uploads an OCI image and assigns it an `algorithmId`. registry-service unpacks the image (daemonless: skopeo + umoci), layers the SCE Unit and nsjail on top, and builds a single Nitro Enclave Image File (EIF). It registers the EIF's PCR measurements against that `algorithmId` with the Verifier Service (over mTLS) and stores the EIF in S3, recording `algorithmId -> S3 path` in DynamoDB.

**Execution phase (SCE).** A caller POSTs an `algorithmId` to the API Gateway and Lambda execution-service control plane, which launches a per-run Nitro Enclave parent EC2 instance. Inside, the SCE Unit seeds enclave entropy from the NSM, attests to the Verifier Service, and - once attestation passes - fetches that algorithm's records from the PDM Service. It hands the records to the jailed Data Controller app over a unix socket, collects the result, and returns it. Results come back asynchronously: `/run` returns a `runId` immediately, the enclave host publishes the result to SQS, a consumer Lambda persists it, and the caller polls `GET /run/{runId}`.

Throughout both phases every component posts timestamped events to the log-service, so a run's full timeline - build to execution - can be exported for benchmarking.

## Service map

Build phase (CSAV):

- [`secure-rads/csav/`](secure-rads/csav/README.md) - the CSAV EC2 host; runs registry-service.
  - [`secure-rads/csav/registry-service/`](secure-rads/csav/registry-service/README.md) - image -> EIF build pipeline, S3/DynamoDB storage, attestation registration.
- [`secure-rads/eif-build/`](secure-rads/eif-build/README.md) - base image supplying `eif_build` and the Nitro kernel/init blobs.
- [`secure-rads/sce-unit/`](secure-rads/sce-unit/README.md) - the in-enclave entrypoint: entropy seeding, attestation, PDM fetch, nsjail, result relay.
- [`secure-rads/verifier-service/`](secure-rads/verifier-service/README.md) - stores PCRs per `algorithmId`, verifies attestation documents at run time.

Execution phase (SCE):

- [`secure-rads/sce/`](secure-rads/sce/README.md) / [`secure-rads/sce/execution-service/`](secure-rads/sce/execution-service/README.md) - Lambda control plane that launches per-run enclaves, returns `runId`, and serves `GET /run/{runId}`.
- [`secure-rads/pdm-service/`](secure-rads/pdm-service/README.md) - the Personal Data Management Service; serves records to an attested enclave.
- [`secure-rads/result-consumer/`](secure-rads/result-consumer/README.md) - SQS-triggered Lambda that persists enclave results to the `RunResults` table.
- [`secure-rads/log-service/`](secure-rads/log-service/README.md) - fire-and-forget run-timeline logger (SQS + worker, JSON/CSV export).

Demo assets:

- [`sample/`](sample/README.md) - five reference Data Controller apps (one per context), each pinned to a fixed `algorithmId`.
- [`seeding/`](seeding/README.md) - generates and seeds the five context datasets into the PDM table.

## Working with an existing environment

Use [Devbox](https://www.jetify.com/docs/devbox/) for all commands. It exports `REGION`, `AWS_REGION`, and `AWS_DEFAULT_REGION` as `ap-southeast-2`, and uses the ignored local AWS files described in [`docs/getting-started.md`](docs/getting-started.md).

```sh
devbox shell
make up       # start the CSAV EC2 host and wait for registry-service
make status   # show the CSAV and execution-service stacks
make demo     # build, seed, and run all five samples
make down     # stop the CSAV EC2 host when finished
```

`make demo` is a persistent, repeatable fleet: it registers each sample under its fixed `algorithmId`, seeds its data, and runs it. Building happens before seeding because registration creates the KMS key used to encrypt each dataset.

Useful root targets:

```sh
make demo-ready                     # start and verify the CSAV host
make demo-build-all                 # build and register all samples
make demo-seed                      # generate and seed all datasets
make demo-run-all                   # run all samples
make logs                           # tail the CSAV host and all Lambda logs
make registry-logs                  # tail the CSAV registry service
make sce-logs                       # tail the execution-service Lambda
```

Single app (APP is a sample/ dir, ALGORITHM_ID its fixed id):

```
make demo-build APP=health-risk-python ALGORITHM_ID=662fa378-dc53-425d-9225-a187b11ea7dc
make demo-run   ALGORITHM_ID=662fa378-dc53-425d-9225-a187b11ea7dc
```

Export a run's timeline (build through execution) as CSV:

```
make logs-csv      ALGORITHM_ID=<id> RUN_ID=<runId>   # one run  -> run-<runId>.csv
make logs-csv-algo ALGORITHM_ID=<id>                  # one algo -> algo-<id>.csv
make logs-csv-all                                     # whole table -> logs-all.csv
```

For a new AWS account or a full deployment, follow [`docs/getting-started.md`](docs/getting-started.md). See each service README for service-specific deployment and internals.
