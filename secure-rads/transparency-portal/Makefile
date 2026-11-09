include ../../mk/env.mk

STACK_NAME := transparency-portal
REGION := $(AWS_REGION)
DOMAIN := $(TRANSPARENCY_DOMAIN_SECURE_RADS)
# us-east-1 certificate (CloudFront requires the cert in us-east-1, unlike the regional API certs).
CERT_ARN := $(CERT_ARN_SECURE_RADS)
BUCKET = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)
DISTRIBUTION_ID = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)
DISTRIBUTION_DOMAIN = $(shell aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
	--query "Stacks[0].Outputs[?OutputKey=='DistributionDomainName'].OutputValue" --output text)

.PHONY: install dev build deploy deploy-infra sync invalidate status

install:
	bun install

dev:
	bun run dev

build:
	bun run build

# S3 bucket + CloudFront distribution (custom domain + ACM cert). Idempotent.
deploy-infra:
	@$(call env_require,AWS_REGION)
	@$(call env_require,CERT_ARN_SECURE_RADS)
	@$(call env_require,TRANSPARENCY_DOMAIN_SECURE_RADS)
	aws cloudformation deploy \
		--template-file cloudformation.yaml \
		--stack-name $(STACK_NAME) \
		--region $(REGION) \
		--parameter-overrides DomainName=$(DOMAIN) CertificateArn=$(CERT_ARN)

sync: build
	@$(call env_require,AWS_REGION)
	aws s3 sync dist/ "s3://$(BUCKET)" --delete --region $(REGION)

invalidate:
	@$(call env_require,AWS_REGION)
	aws cloudfront create-invalidation --distribution-id $(DISTRIBUTION_ID) --paths "/*"

# Full deploy: build the SPA, upload it, and flush the edge cache.
deploy: sync invalidate
	@echo "deployed https://$(DOMAIN) (origin $(DISTRIBUTION_DOMAIN))"

status:
	@echo "bucket:       $(BUCKET)"
	@echo "distribution: $(DISTRIBUTION_ID) ($(DISTRIBUTION_DOMAIN))"
	@echo "domain:       https://$(DOMAIN)"
