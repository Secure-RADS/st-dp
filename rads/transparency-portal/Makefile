STACK_NAME := rads-transparency-portal
REGION ?= ap-southeast-2
DOMAIN ?= transparency.r.secure-rads.org
# us-east-1 certificate (CloudFront requires the cert in us-east-1, unlike the regional API certs). The
# default below is the secure-rads portal certificate, which covers only transparency.sr.secure-rads.org:
# pass CERT_ARN for a us-east-1 certificate that also covers transparency.r.secure-rads.org.
CERT_ARN ?= arn:aws:acm:us-east-1:615299756331:certificate/12f0557e-a816-4dcd-90a8-8941250c9db4
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
	aws cloudformation deploy \
		--template-file cloudformation.yaml \
		--stack-name $(STACK_NAME) \
		--region $(REGION) \
		--parameter-overrides DomainName=$(DOMAIN) CertificateArn=$(CERT_ARN)

sync: build
	aws s3 sync dist/ "s3://$(BUCKET)" --delete --region $(REGION)

invalidate:
	aws cloudfront create-invalidation --distribution-id $(DISTRIBUTION_ID) --paths "/*"

# Full deploy: build the SPA, upload it, and flush the edge cache.
deploy: sync invalidate
	@echo "deployed https://$(DOMAIN) (origin $(DISTRIBUTION_DOMAIN))"

status:
	@echo "bucket:       $(BUCKET)"
	@echo "distribution: $(DISTRIBUTION_ID) ($(DISTRIBUTION_DOMAIN))"
	@echo "domain:       https://$(DOMAIN)"
