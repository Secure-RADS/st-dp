# Running and operating the PoC

## Requirements

- [Devbox](https://www.jetify.com/docs/devbox/) for every command in this repo.
- Docker Engine or Docker Desktop, running. Devbox provides the client only.
- An AWS account with permissions to create EC2, Lambda, API Gateway, DynamoDB, S3, KMS, SQS, IAM
  roles, and CloudFormation stacks.
- `ap-southeast-2` (Sydney), pinned by Devbox. The default AZ for the enclave host is
  `ap-southeast-2b`, and the CSAV instance is `t4g.small`; the per-run enclave host is `c6g.large`.
  All are overridable through the stack parameters.
- AWS credentials in the ignored `.aws/credentials` file, as described in
  [`getting-started.md`](getting-started.md).

## Cost and account safety

Running this creates billable resources:

- the CSAV EC2 host stays up until `make down`, and is the thing to stop when you are finished;
- every run launches an enclave host EC2 instance, which terminates itself after the run;
- KMS key creation, encryption requests, S3 storage, DynamoDB writes, and Lambda invocations are all
  metered, and the cost-service records their estimated cost per run;
- `make benchmark` is a size sweep and launches many instances; run it deliberately.

Use a dedicated research account. The datasets in [`../seeding/`](../seeding/README.md) are synthetic,
and nothing here is designed to hold real personal data.

## Working with an existing environment

Use [Devbox](https://www.jetify.com/docs/devbox/) for all commands. It exports `REGION`, `AWS_REGION`,
and `AWS_DEFAULT_REGION` as `ap-southeast-2`, and uses the ignored local AWS files described in
[`getting-started.md`](getting-started.md).

```sh
devbox shell
make up             # start the CSAV EC2 host and wait for registry-service
make status         # show the CSAV, SCE, and rads stacks
make secure-rads    # build, seed, and run all five samples
make down           # stop the CSAV EC2 host when finished
```

`make secure-rads` is a persistent, repeatable fleet: it registers each sample under its fixed
`algorithmId`, seeds its data, and runs it. Building happens before seeding because registration
creates the KMS key used to encrypt each dataset.

Useful root targets:

```sh
make secure-rads-ready                     # start and verify the CSAV host
make secure-rads-build-all                 # build and register all samples
make secure-rads-seed                      # generate and seed all datasets
make secure-rads-run-all                   # run all samples
make benchmark                             # Exp1/Exp2 size sweep (override REPS= TREES= …)
make benchmark-report                      # export sweep CSV + figures
make logs                                  # tail the CSAV host and all Lambda logs
make registry-logs                         # tail the CSAV registry service
make sce-logs                              # tail the execution-service Lambda
make portal-dev                            # run the secure transparency portal locally
make portal-deploy                         # deploy the secure transparency portal
```

Single app (APP is a secure/samples/ dir, ALGORITHM_ID its fixed id):

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

For a new AWS account or a full deployment, follow [`getting-started.md`](getting-started.md). See each
service README for service-specific deployment and internals.
