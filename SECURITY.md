# Security policy

## Status of this software

Secure-RADS is a research proof of concept. It is not hardened for production use, and no security
guarantee is offered. Deploying it with real personal data is out of scope.

## Reporting a vulnerability

Do not open a public issue.

Email <security@secure-rads.org> with:

- the affected component (registry-service, sce-unit, verifier-service, pdm-service, execution
  service, or the AWS templates)
- a description of the issue and its impact
- reproduction steps or a proof of concept
- the commit you tested

If the report involves a credential, revoke it first; do not send the secret itself.

## What is in scope

- Attestation bypass: an enclave or process that should fail verification and does not.
- Trust boundary breaks: the Data Controller app reaching data outside the records streamed over its `SCE_RPC_SOCKET`, or reading decrypted records after the run.
- Enclave escape or unintended host access from `sce-unit` or the jailed app.
- Secret exposure in the repository or in build artifacts.
- IAM or resource policies that grant more than the documented flow requires.

## What is out of scope

- Findings that require control of the AWS account or the build host.
- Denial of service against your own deployment.
- Missing hardening already tracked as an open issue.
- Reports from automated scanners with no demonstrated impact.

## Process

Reports are acknowledged on a best-effort basis; this is a research project and there is no
service-level agreement or bounty. Fixes land in `main` and are noted in the release notes when a
release is cut. Please allow time for a fix before public disclosure.
