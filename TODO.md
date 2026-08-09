# TODO

- Move `docker-compose.yml` off scp-per-ship and bake it into the CSAV instance at boot (systemd unit) instead, once there are multiple services sharing the compose file.
- ~~Split the build step (docker.sock access) out of registry-service into a separate internal-only process.~~ Resolved differently: switched the whole build pipeline off Docker/buildah entirely, onto skopeo+umoci - no daemon, no socket, no special capabilities needed at all.
- Go through `csav/registary-service/nsjail.cfg.tmpl` again and see if there are more configurations we can add to lock down the DC app's permissions further (e.g. more syscalls to deny, tighter rlimits).
- Put nginx in front of registry-service as a reverse proxy - requests hit nginx first, nginx forwards to the app, instead of the app's :8080 being exposed directly.
