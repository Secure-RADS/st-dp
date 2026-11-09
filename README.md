# Secure-RADS

Research proof of concept of the Secure Computing Environment (SCE) on AWS Nitro Enclaves, with the
fully trusted RADS baseline included alongside it for comparison. It accompanies a research paper that
is not published yet; citation details will be added with the publication.

This is not production software. It is published so the design and measurements can be inspected and
reproduced. There is no support commitment and no security guarantee. It is licensed under the
Apache License 2.0; see [License](#license).

RADS is the baseline system. Secure-RADS extends it with the security controls required for protected personal-data computation, including KMS-backed encryption and enclave attestation. The current Secure-RADS implementation is a PoC of the Secure Computing Environment (SCE) on AWS Nitro Enclaves. A Data Controller's algorithm runs inside an attested enclave over a data subject's personal data, so the data is processed without the Data Controller ever seeing it.

## rads (baseline)

[`rads/`](rads/) is the fully-trusted baseline sibling: no KMS, no Nitro enclave, no verifier. A data controller's docker image tarball is uploaded to the registry-service (`rads/csav/registry-service`), stored raw in S3, and recorded as `algorithmId -> S3 path` in DynamoDB. At run time the execution-service (`rads/sce/execution-service`) launches a plain EC2 executor that docker-loads the image, fetches records from PDM into `records.json`, and runs the app with `RECORDS_PATH` / `RESULT_PATH`. The result file is delivered asynchronously to result-consumer; stdout is the diagnostic fallback. The same log-service records the run timeline.

Every rads AWS resource is prefixed `rads-`; every secure-rads resource is prefixed `secure-rads-`, so both systems deploy and run side by side in one account/region.

## The two phases

**Build phase (CSAV).** A Data Controller uploads an OCI image and assigns it an `algorithmId`. registry-service unpacks the image (daemonless: skopeo + umoci), layers the SCE Unit and nsjail on top, and builds a single Nitro Enclave Image File (EIF). It registers the EIF's PCR measurements against that `algorithmId` with the Verifier Service (over mTLS) and stores the EIF in S3, recording `algorithmId -> S3 path` in DynamoDB.

**Execution phase (SCE).** A caller POSTs an `algorithmId` to the API Gateway and Lambda execution-service control plane, which launches a per-run Nitro Enclave parent EC2 instance. Inside, the SCE Unit seeds enclave entropy from the NSM, attests to the Verifier Service, and - once attestation passes - fetches that algorithm's records from the PDM Service, decrypts them, and writes `records.json` for the jailed Data Controller app (`RECORDS_PATH` / `RESULT_PATH`, same file contract as rads). Results come back asynchronously: `/run` returns a `runId` immediately, the enclave host publishes the result to SQS, a consumer Lambda persists it, and the caller polls `GET /run/{runId}`.

Throughout both phases every component posts timestamped events to the log-service, so a run's full timeline - build to execution - can be exported for benchmarking. Components also report selected, attributable AWS operations to the cost-service, keyed by the same `(AlgorithmId, runId)`, so their estimated costs can be summed per AWS service ([`docs/cost-service.md`](docs/cost-service.md)). Event-by-event plaintext flows: [`docs/e2e-rads.txt`](docs/e2e-rads.txt), [`docs/e2e-secure-rads.txt`](docs/e2e-secure-rads.txt).

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
- [`secure-rads/cost-service/`](secure-rads/cost-service/README.md) - fire-and-forget AWS cost meter (SQS + worker, per-operation rows summed per run). See [`docs/cost-service.md`](docs/cost-service.md).

Sample assets:

- [`secure-rads/samples/`](secure-rads/samples/README.md) - five reference Data Controller apps (one per context), each pinned to a fixed `algorithmId`.
- [`seeding/`](seeding/README.md) - generates and seeds the five context datasets into the PDM table.
- [`benchmark/`](benchmark/README.md) - Exp1/Exp2 size sweep (rads vs secure-rads). `make benchmark` / `make benchmark-report`; see that README for overrides.

## Requirements

- [Devbox](https://www.jetify.com/docs/devbox/) for every command in this repo.
- Docker Engine or Docker Desktop, running. Devbox provides the client only.
- An AWS account with permissions to create EC2, Lambda, API Gateway, DynamoDB, S3, KMS, SQS, IAM
  roles, and CloudFormation stacks.
- `ap-southeast-2` (Sydney), pinned by Devbox. The default AZ for the enclave host is
  `ap-southeast-2b`, and the CSAV instance is `t4g.small`; the per-run enclave host is `c6g.large`.
  All are overridable through the stack parameters.
- AWS credentials in the ignored `.aws/credentials` file, as described in
  [`docs/getting-started.md`](docs/getting-started.md).

## Cost and account safety

Running this creates billable resources:

- the CSAV EC2 host stays up until `make down`, and is the thing to stop when you are finished;
- every run launches an enclave host EC2 instance, which terminates itself after the run;
- KMS key creation, encryption requests, S3 storage, DynamoDB writes, and Lambda invocations are all
  metered, and the cost-service records their estimated cost per run;
- `make benchmark` is a size sweep and launches many instances; run it deliberately.

Use a dedicated research account. The datasets in [`seeding/`](seeding/README.md) are synthetic, and
nothing here is designed to hold real personal data.

## Working with an existing environment

Use [Devbox](https://www.jetify.com/docs/devbox/) for all commands. It exports `REGION`, `AWS_REGION`, and `AWS_DEFAULT_REGION` as `ap-southeast-2`, and uses the ignored local AWS files described in [`docs/getting-started.md`](docs/getting-started.md).

```sh
devbox shell
make up       # start the CSAV EC2 host and wait for registry-service
make status   # show the CSAV and execution-service stacks
make secure-rads  # build, seed, and run all five samples
make down     # stop the CSAV EC2 host when finished
```

`make secure-rads` is a persistent, repeatable fleet: it registers each sample under its fixed `algorithmId`, seeds its data, and runs it. Building happens before seeding because registration creates the KMS key used to encrypt each dataset.

Useful root targets:

```sh
make secure-rads-ready                     # start and verify the CSAV host
make secure-rads-build-all                 # build and register all samples
make secure-rads-seed                      # generate and seed all datasets
make secure-rads-run-all                   # run all samples
make benchmark                             # Exp2 size sweep (override REPS= SIZES= …)
make benchmark-report                      # export sweep CSV + figures
make logs                           # tail the CSAV host and all Lambda logs
make registry-logs                  # tail the CSAV registry service
make sce-logs                       # tail the execution-service Lambda
```

Single app (APP is a secure-rads/samples/ dir, ALGORITHM_ID its fixed id):

```sh
make secure-rads-build APP=health-risk-python ALGORITHM_ID=662fa378-dc53-425d-9225-a187b11ea7dc
make secure-rads-run   ALGORITHM_ID=662fa378-dc53-425d-9225-a187b11ea7dc
```

Export a run's timeline (build through execution) as CSV:

```sh
make logs-csv      ALGORITHM_ID=<id> RUN_ID=<runId>   # one run  -> run-<runId>.csv
make logs-csv-algo ALGORITHM_ID=<id>                  # one algo -> algo-<id>.csv
make logs-csv-all                                     # whole table -> logs-all.csv
make cost-csv      ALGORITHM_ID=<id> RUN_ID=<runId>   # one run's cost rows
make cost-csv-algo ALGORITHM_ID=<id>                  # one algo's cost rows
make cost-csv-all                                     # whole cost table
```

For a new AWS account or a full deployment, follow [`docs/getting-started.md`](docs/getting-started.md). See each service README for service-specific deployment and internals.

## Deferred work

Work identified during the PoC that is out of scope for this repository is listed in [`TODO.md`](TODO.md), each item linked to the closed issue holding the full analysis.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev environment, the checks to run, and the pull
request expectations. Participation is covered by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md). Do not open a public
issue for them.

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
See [`CONTRIBUTING.md`](CONTRIBUTING.md#licensing-of-contributions) for how that affects
contributions.

## Citation

The paper this work supports is not published yet. Citation details, and a `CITATION.cff`, will be
added when it is.
