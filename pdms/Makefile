.PHONY: gen-client-cert

# PDMS's own mTLS identity for calling verifier-service's /introspect -
# distinct from sce-unit's cert (which authenticates the other direction,
# sce-unit -> PDMS). PoC only, baked into the Lambda deployment package.
gen-client-cert:
	mkdir -p certs
	openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -days 3650 -nodes \
		-keyout certs/client.key -out certs/client.crt \
		-subj "/CN=pdms"
