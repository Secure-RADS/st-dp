include ../../mk/env.mk

REGION := $(AWS_REGION)
CERT_PARAM := /secure-rads/pdm-service/client-cert
KEY_PARAM := /secure-rads/pdm-service/client-key

.PHONY: gen-client-cert store-client-cert

# Self-signed client cert for the execution-service -> PDM count call. PoC only.
gen-client-cert:
	mkdir -p tls
	openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -days 3650 -nodes \
		-keyout tls/client.key -out tls/client.crt \
		-subj "/CN=execution-service"

# Store the cert/key where execution-service reads them at cold start.
store-client-cert:
	@test -f tls/client.crt -a -f tls/client.key || { echo "run make gen-client-cert first"; exit 1; }
	aws ssm put-parameter --region $(REGION) --name $(CERT_PARAM) --type SecureString \
		--value "file://tls/client.crt" --overwrite
	aws ssm put-parameter --region $(REGION) --name $(KEY_PARAM) --type SecureString \
		--value "file://tls/client.key" --overwrite
