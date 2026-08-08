# TODO

- Move `docker-compose.yml` off scp-per-ship and bake it into the CSAV instance at boot (systemd unit) instead, once there are multiple services sharing the compose file.
- Switch `sample/registary-oci/Dockerfile` to a uv-based Dockerfile (kept plain/flat for now since it needs to be decomposed for the registry-service build step soon).
