# TODO

- Move `docker-compose.yml` off scp-per-ship and bake it into the CSAV instance at boot (systemd unit) instead, once there are multiple services sharing the compose file.
- Switch `sample/registary-oci/Dockerfile` to a uv-based Dockerfile (kept plain/flat for now since it needs to be decomposed for the registry-service build step soon).
- Split the build step (docker.sock access) out of registry-service into a separate internal-only process. Right now the public /upload endpoint's process also holds docker.sock, which is an indirect path to host-root on a public-facing box - security risk, kept as one service for now for simplicity.
- Go through `csav/registary-service/nsjail.cfg.tmpl` again and see if there are more configurations we can add to lock down the DC app's permissions further (e.g. more syscalls to deny, tighter rlimits).
