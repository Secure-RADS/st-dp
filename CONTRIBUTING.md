# Contributing

This repository is a research PoC of the Secure Computing Environment (SCE) on AWS Nitro Enclaves.
Scope is limited to what the published work needs. Items deliberately left out are listed in
[`TODO.md`](TODO.md); changes outside that scope may be declined.

## Development environment

Everything runs through [Devbox](https://www.jetify.com/docs/devbox/), which supplies the CLI tools,
the pinned Go and Bun versions, and the AWS environment variables for `ap-southeast-2`.

```sh
devbox shell
pre-commit install
```

Docker must be running on the host. Devbox provides the client, not a daemon.

## Checks before opening a PR

```sh
pre-commit run --all-files
```

That runs secret detection, Python and Go formatting, ShellCheck, yamllint, markdownlint, and Biome
in every package that has a `biome.json`.

Per-language checks, matching CI:

```sh
(cd benchmark && uvx ruff==0.17.4 check . && uvx ruff==0.17.4 format --check .)
(cd secure-rads/sce-unit && go vet ./... && go build ./...)
(cd packages/common && bun run lint && bun run typecheck)
```

The TypeScript packages each have `lint` and `typecheck` scripts. Run them in any package you touch.

## Pull requests

1. Branch from `main`, keep the branch short-lived.
2. Keep one coherent change per PR. Do not mix refactors with behaviour changes.
3. Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/):
   `fix(sce-unit): handle empty records file`, `docs: clarify cost warning`.
4. Describe the behaviour change, what you verified, and any review or test gap in the PR body.
5. Do not commit generated output, `dist/`, benchmark result files unrelated to your change, or any
   AWS credentials, account IDs, ARNs, or KMS key IDs.

## Reporting problems

- Bugs and feature requests: open an issue using the templates.
- Security issues: follow [`SECURITY.md`](SECURITY.md), never a public issue.
- Conduct concerns: see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Licensing of contributions

This repository currently ships without a license, so no rights are granted to use, modify, or
redistribute it. Contributions are accepted on the understanding that the maintainers may license
the combined work later, and that contributors grant the maintainers the rights needed to do so.
Open an issue if you need different terms before contributing.
