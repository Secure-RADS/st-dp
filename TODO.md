# Deferred work

Work identified during the PoC that is out of scope for this repository. The PoC is published as-is, so these items are not implemented here. Each links to the closed issue that carries the full analysis.

## Benchmark

- **Enclave clock drift** - the enclave clock differs from the EC2 host clock, so timings measured inside the enclave vary between runs. Needs a resolution before benchmark numbers are compared across runs ([#54](https://github.com/Secure-RADS/st-dp/issues/54)).

## Data and storage

- **DynamoDB indexes** - evaluate whether secondary indexes fit the PoC's query patterns without excessive cost or schema churn ([#50](https://github.com/Secure-RADS/st-dp/issues/50)).

## Transport and attestation

- **Post-quantum TLS** - determine whether enclave-to-verifier and enclave-to-PDM TLS can negotiate only PQ-safe or hybrid key exchange, and whether fallback can be disabled ([#49](https://github.com/Secure-RADS/st-dp/issues/49)).
- **Enclave TLS trust model** - leaf SPKI pinning ties the measured image to certificates we do not control, so every ACM renewal forces a rebuild, re-registration, new KMS key, and re-seed. Pinning the Amazon root trust set is the likely replacement ([#29](https://github.com/Secure-RADS/st-dp/issues/29)).
- **KMS ownership for EIF signing** - real signing needs an owner for the signing key, because whoever controls it controls trust for every build produced by registry-service ([#10](https://github.com/Secure-RADS/st-dp/issues/10)).

## Build and delivery

- **Single deploy path** - deploys are manual across four sub-Makefiles, and the registry-service image cannot be rebuilt from the repo as-is (gitignored mTLS material, private base image, host prerequisites) ([#40](https://github.com/Secure-RADS/st-dp/issues/40)).

## Enclave interface

- **Real gRPC between sce-unit and the DC app** - replace the placeholder protocol, where any non-empty bytes triggers a response, with a shared protobuf contract over the same unix socket ([#21](https://github.com/Secure-RADS/st-dp/issues/21)).
