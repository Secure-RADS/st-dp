# eif-build

Build-time base image that supplies the pieces registry-service needs to turn a Data Controller's OCI image into a Nitro Enclave EIF.

`eif_build` has no prebuilt binary upstream, so the `Dockerfile` cargo-builds it from a pinned tag (`aws-nitro-enclaves-image-format` v0.6.0) and copies in the matching Nitro kernel and bootstrap blobs from `aws-nitro-enclaves-cli`:

- `eif_build` - assembles the final EIF and prints its PCR measurements.
- `Image`, `Image.config`, `cmdline` - the enclave kernel and its boot config.
- `bootstrap.cpio` - the bootable init ramdisk (`/init`, `/nsm.ko`, `/dev`).

Everything lands under `/opt/assets/eif`. registry-service's `Dockerfile` pulls this in as `FROM eif-build-base:latest` and reads the blobs from that path (see `secure-rads/csav/registry-service/eif.go`).

The blob version is pinned to match the enclave host's Nitro CLI (`secure-rads/sce/execution-service`); a mismatch fails the enclave boot handshake with AWS's E36/E39 ready-signal errors.

## Build

Built as a local base image, not pushed to a registry:

```
docker build --platform linux/arm64 -t eif-build-base:latest eif-build
```

`make -C secure-rads/csav/registry-service eif-build-base` does this, and `make -C secure-rads/csav/registry-service image` depends on it. Rebuild only when this directory changes.
