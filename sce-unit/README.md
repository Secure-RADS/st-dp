# sce-unit

The composed image's real entrypoint. Runs as root, spawns nsjail (which
drops the Data Controller's app into its jail), then connects out to the
DC app as a client over a unix socket to relay a request, then streams the
response to the parent instance over vsock (CID 3, port 5000) - the enclave's
only channel out.
