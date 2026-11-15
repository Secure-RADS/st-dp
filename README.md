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

![ST-DP architecture](docs/images/st-dp-architecture.png)

ST-DP separates the entity that decides why personal data is processed from the services that hold,
process, and record that processing. A Data Controller uploads an OCI image, the build phase turns it
into a single Nitro Enclave image with the SCE Unit and nsjail layered on top, and the execution phase
runs it in an attested enclave that fetches encrypted records, decrypts them, and reports its result
and timeline asynchronously.

Roles, the two phases, the rads baseline, the service map, and the event-level data flows are in
[`docs/architecture.md`](docs/architecture.md).

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

- [`docs/architecture.md`](docs/architecture.md) - roles, build and execution phases, service map,
  rads baseline.
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
