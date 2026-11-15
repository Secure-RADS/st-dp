# ST-DP

Research proof of concept of the Secure Computing Environment (SCE) in the Secure and Transparent Data
Processing (ST-DP) architecture on AWS Nitro Enclaves, with the fully trusted RADS baseline included
alongside it for comparison. It accompanies a research paper that is not published yet; citation
details will be added with the publication.

A Data Controller's algorithm runs inside an attested enclave over a data subject's personal data, so
the data is processed without the Data Controller ever seeing it. RADS is the baseline; Secure-RADS
extends it with the security controls required for protected personal-data computation, including
KMS-backed encryption and enclave attestation.

This is not production software. It is published so the design and measurements can be inspected and
reproduced. There is no support commitment and no security guarantee. It is licensed under the
Apache License 2.0; see [License](#license).

## Architecture

![Secure-RADS architecture: the SCE Unit and the DC application run inside a measured Nitro Enclave](docs/images/st-dp-architecture.png)

ST-DP separates the entity that decides why personal data is processed from the services that hold,
process, and record that processing. Black edges are request and data paths, orange is remote
attestation, and blue is data-key release.

- **Data Subject (DS)** gives consent and personal data, and queries how the data was used.
- **Personal Data Management (PDM)** stores personal data against its consent and algorithm, serves it only to an attested SCE, and answers DS queries by querying the Log Service.
- **Algorithm Registry (AR)** holds algorithms that were vetted and validated against a consent, and registers their measurements with the Verifier. In this PoC, registry-service performs the registration; algorithm vetting and consent approval are out of scope.
- **Verifier** stores the expected measurements per algorithm and issues a signed, time-constrained token to an SCE that attests correctly.
- **Key Management Service (KMS)** releases the data-encryption key only to an SCE holding a valid verifier token.
- **Log Service** holds the processing records that support DS and Supervisory Authority queries.
- **Secure Computing Environment (SCE)** fetches encrypted records, decrypts them, runs the DC's algorithm inside the enclave, and records the run with the Log Service.

This repo implements the SCE and the supporting services needed to run and inspect it. Consent capture,
algorithm vetting, and consent-to-algorithm validation are not implemented. The Supervisory Authority
role is served by the transparency portal's authority view, a read-only dashboard rather than a separate
service.

## rads (baseline)

[`rads/`](rads/) is the fully-trusted baseline sibling: no KMS, no Nitro enclave, no verifier. A data controller's docker image tarball is uploaded to the registry-service (`rads/csav/registry-service`), stored raw in S3, and recorded as `algorithmId -> S3 path` in DynamoDB. At run time the execution-service (`rads/sce/execution-service`) launches a plain EC2 executor that docker-loads the image, fetches records from PDM into `records.json`, and runs the app with `RECORDS_PATH` / `RESULT_PATH`. The result file is delivered asynchronously to result-consumer; stdout is the diagnostic fallback. The same log-service records the run timeline.

![RADS baseline architecture: a plain EC2 executor runs the DC application in Docker with no enclave or attestation](docs/images/rads-baseline-architecture.png)

Every rads AWS resource is prefixed `rads-`; every secure-rads resource is prefixed `secure-rads-`, so both systems deploy and run side by side in one account/region.

## The two phases

**Build phase (CSAV).** A Data Controller uploads an OCI image and assigns it an `algorithmId`. registry-service unpacks the image (daemonless: skopeo + umoci), layers the SCE Unit and nsjail on top, and builds a single Nitro Enclave Image File (EIF). It registers the EIF's PCR measurements against that `algorithmId` with the Verifier Service (over mTLS) and stores the EIF in S3, recording `algorithmId -> S3 path` in DynamoDB.

**Execution phase (SCE).** A caller POSTs an `algorithmId` to the API Gateway and Lambda execution-service control plane, which launches a per-run Nitro Enclave parent EC2 instance. Inside, the SCE Unit seeds enclave entropy from the NSM, attests to the Verifier Service, and - once attestation passes - fetches that algorithm's records from the PDM Service, gets the data key unwrapped by the KMS Service, decrypts them, and writes `records.json` for the jailed Data Controller app (`RECORDS_PATH` / `RESULT_PATH`, same file contract as rads). Results come back asynchronously: `/run` returns a `runId` immediately, the enclave host publishes the result to SQS, a consumer Lambda persists it, and the caller polls `GET /run/{runId}`.

Throughout both phases every component posts timestamped events to the log-service, so a run's full timeline - build to execution - can be exported for benchmarking. Components also report selected, attributable AWS operations to the cost-service, keyed by the same `(AlgorithmId, runId)`, so their estimated costs can be summed per AWS service ([`docs/cost-service.md`](docs/cost-service.md)). Event-by-event plaintext flows: [`docs/e2e-rads.txt`](docs/e2e-rads.txt), [`docs/e2e-secure-rads.txt`](docs/e2e-secure-rads.txt).

## Service map

Build phase (CSAV):

- [`secure/csav/`](secure/csav/README.md) - the CSAV EC2 host; runs registry-service.
  - [`secure/csav/registry-service/`](secure/csav/registry-service/README.md) - image -> EIF build pipeline, S3/DynamoDB storage, attestation registration.
- [`secure/eif-build/`](secure/eif-build/README.md) - base image supplying `eif_build` and the Nitro kernel/init blobs.
- [`secure/sce-unit/`](secure/sce-unit/README.md) - the in-enclave entrypoint: entropy seeding, attestation, PDM fetch, nsjail, result relay.
- [`secure/verifier-service/`](secure/verifier-service/README.md) - stores PCRs per `algorithmId`, verifies attestation documents at run time.

Execution phase (SCE):

- [`secure/sce/`](secure/sce/README.md) / [`secure/sce/execution-service/`](secure/sce/execution-service/README.md) - Lambda control plane that launches per-run enclaves, returns `runId`, and serves `GET /run/{runId}`.
- [`secure/pdm-service/`](secure/pdm-service/README.md) - the Personal Data Management Service; serves records to an attested enclave.
- [`secure/kms-service/`](secure/kms-service/README.md) - the enclave's only path to AWS KMS; authorizes a verifier token and performs `Decrypt` with the enclave's attestation document as the recipient, so the enclave holds no AWS credentials.
- [`secure/result-consumer/`](secure/result-consumer/README.md) - SQS-triggered Lambda that persists enclave results to the `RunResults` table.
- [`secure/log-service/`](secure/log-service/README.md) - fire-and-forget run-timeline logger (SQS + worker, JSON/CSV export).
- [`secure/cost-service/`](secure/cost-service/README.md) - fire-and-forget AWS cost meter (SQS + worker, per-operation rows summed per run). See [`docs/cost-service.md`](docs/cost-service.md).

Transparency portals:

- [`secure/transparency-portal/`](secure/transparency-portal/README.md) - data-subject lookup and authority dashboard for the secure deployment.
- [`rads/transparency-portal/`](rads/transparency-portal/README.md) - the same SPA pointed at the baseline endpoints.

Sample assets:

- [`secure/samples/`](secure/samples/README.md) - five reference Data Controller apps (one per context), each pinned to a fixed `algorithmId`.
- [`seeding/`](seeding/README.md) - generates and seeds the five context datasets into the PDM table.
- [`benchmark/`](benchmark/README.md) - Exp1/Exp2 size sweep (rads vs secure-rads). `make benchmark` / `make benchmark-report`; see that README for overrides.

## Quick start

Everything runs through [Devbox](https://www.jetify.com/docs/devbox/) with a running Docker daemon and
AWS credentials in the ignored `.aws/credentials` file. See
[`docs/getting-started.md`](docs/getting-started.md) for a new account and
[`docs/running.md`](docs/running.md) for requirements, cost warnings, and the full make target list.

```sh
devbox shell
make up             # start the CSAV EC2 host and wait for registry-service
make secure-rads    # build, seed, and run all five samples
make down           # stop the CSAV EC2 host when finished
```

Everything here is billable: the CSAV host stays up until `make down`, and every run launches an EC2
instance. Use a dedicated research account.

## Documentation

- [`docs/getting-started.md`](docs/getting-started.md) - local prerequisites, AWS credentials, and a
  full deployment in a new account and region.
- [`docs/running.md`](docs/running.md) - requirements, cost and account safety, make targets, CSV
  exports.
- [`docs/cost-service.md`](docs/cost-service.md) - how per-run AWS costs are metered.
- [`docs/e2e-rads.txt`](docs/e2e-rads.txt), [`docs/e2e-secure-rads.txt`](docs/e2e-secure-rads.txt) -
  event-by-event plaintext flows for the build and execution phases.

## Deferred work

Work identified during the PoC that is out of scope for this repository is listed in [`TODO.md`](TODO.md),
each item linked to the closed issue holding the full analysis.

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
