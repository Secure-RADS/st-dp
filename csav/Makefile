STACK_NAME := csav
KEY_NAME := csav-key
KEY_PATH := $(HOME)/.ssh/$(KEY_NAME).pem
REGION ?= ap-south-1

.PHONY: build test run clean key deploy destroy up down status ssh

build:
	@echo "not implemented yet"

test:
	@echo "not implemented yet"

run:
	@echo "not implemented yet"

clean:
	@echo "not implemented yet"

key:
	aws ec2 create-key-pair --key-name $(KEY_NAME) --region $(REGION) \
		--query 'KeyMaterial' --output text > $(KEY_PATH)
	chmod 400 $(KEY_PATH)

deploy:
	aws cloudformation deploy \
		--template-file cloudformation.yaml \
		--stack-name $(STACK_NAME) \
		--region $(REGION) \
		--parameter-overrides KeyName=$(KEY_NAME)

destroy:
	aws cloudformation delete-stack --stack-name $(STACK_NAME) --region $(REGION)

status:
	aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
		--query 'Stacks[0].Outputs'

up:
	aws ec2 start-instances --region $(REGION) --instance-ids \
		$$(aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
			--query "Stacks[0].Outputs[?OutputKey=='CsavInstanceId'].OutputValue" --output text)

down:
	aws ec2 stop-instances --region $(REGION) --instance-ids \
		$$(aws cloudformation describe-stacks --stack-name $(STACK_NAME) --region $(REGION) \
			--query "Stacks[0].Outputs[?OutputKey=='CsavInstanceId'].OutputValue" --output text)

ssh:
	ssh -i $(KEY_PATH) ec2-user@$$(aws cloudformation describe-stacks --stack-name $(STACK_NAME) \
		--region $(REGION) --query "Stacks[0].Outputs[?OutputKey=='CsavInstancePublicIp'].OutputValue" --output text)
