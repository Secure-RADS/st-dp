# Secure Computing Environment

PoC of the Secure Computing Environment (SCE) on AWS Nitro Enclaves. A Data Controller's algorithm runs inside an attested enclave over a data subject's personal data, so the data is processed without the Data Controller ever seeing it. This repo covers the whole workflow end to end: a **build phase** that turns an algorithm image into an enclave artifact, and an **execution phase** that runs it against real records under remote attestation.

## The two phases

**Build phase (CSAV).** A Data Controller uploads an OCI image and assigns it an `algorithmId`. registry-service unpacks the image (daemonless: skopeo + umoci), layers the SCE Unit and nsjail on top, and builds a single Nitro Enclave Image File (EIF). It registers the EIF's PCR measurements against that `algorithmId` with the Verifier Service (over mTLS) and stores the EIF in S3, recording `algorithmId -> S3 path` in DynamoDB.

**Execution phase (SCE).** A caller POSTs an `algorithmId` to execution-service, which launches a per-run Nitro Enclave. Inside, the SCE Unit seeds enclave entropy from the NSM, attests to the Verifier Service, and - once attestation passes - fetches that algorithm's records from the PDM Service. It hands the records to the jailed Data Controller app over a unix socket, collects the result, and returns it. Results come back asynchronously: `/run` returns a `runId` immediately, the enclave host publishes the result to SQS, a consumer Lambda persists it, and the caller polls `GET /run/{runId}`.

Throughout both phases every component posts timestamped events to the log-service, so a run's full timeline - build to execution - can be exported for benchmarking.

## Service map

Build phase (CSAV):

- [`csav/`](csav/README.md) - the CSAV EC2 host; runs registry-service.
  - [`csav/registry-service/`](csav/registry-service/README.md) - image -> EIF build pipeline, S3/DynamoDB storage, attestation registration.
- [`eif-build/`](eif-build/README.md) - base image supplying `eif_build` and the Nitro kernel/init blobs.
- [`sce-unit/`](sce-unit/README.md) - the in-enclave entrypoint: entropy seeding, attestation, PDM fetch, nsjail, result relay.
- [`verifier-service/`](verifier-service/README.md) - stores PCRs per `algorithmId`, verifies attestation documents at run time.

Execution phase (SCE):

- [`sce/`](sce/README.md) / [`sce/execution-service/`](sce/execution-service/README.md) - launches per-run enclaves, returns `runId`, serves `GET /run/{runId}`.
- [`pdm-service/`](pdm-service/README.md) - the Personal Data Management Service; serves records to an attested enclave.
- [`result-consumer/`](result-consumer/README.md) - SQS-triggered Lambda that persists enclave results to the `RunResults` table.
- [`log-service/`](log-service/README.md) - fire-and-forget run-timeline logger (SQS + worker, JSON/CSV export).

Demo assets:

- [`sample/`](sample/README.md) - five reference Data Controller apps (one per context), each pinned to a fixed `algorithmId`.
- [`seeding/`](seeding/README.md) - generates and seeds the five context datasets into the PDM table.

## Working with an existing environment

Use [Devbox](https://www.jetify.com/docs/devbox/) for all commands. It exports `REGION`, `AWS_REGION`, and `AWS_DEFAULT_REGION` as `ap-southeast-2`, and uses the ignored local AWS files described in [`docs/getting-started.md`](docs/getting-started.md).

```sh
devbox shell
make up       # start both EC2 hosts and wait for their services
make status   # show both CloudFormation stacks
make demo     # build, seed, and run all five samples
make down     # stop both EC2 hosts when finished
```

`make demo` is a persistent, repeatable fleet: it registers each sample under its fixed `algorithmId`, seeds its data, and runs it. Building happens before seeding because registration creates the KMS key used to encrypt each dataset.

Useful root targets:

```sh
make demo-ready                     # start and verify both hosts
make demo-build-all                 # build and register all samples
make demo-seed                      # generate and seed all datasets
make demo-run-all                   # run all samples
make logs                           # tail both host and all Lambda logs
make registry-logs                  # tail the CSAV registry service
make sce-logs                       # tail the execution service
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
