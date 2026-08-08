.PHONY: csav-key csav-deploy csav-destroy csav-status csav-up csav-down csav-ssh

csav-key:
	$(MAKE) -C csav key

csav-deploy:
	$(MAKE) -C csav deploy

csav-destroy:
	$(MAKE) -C csav destroy

csav-status:
	$(MAKE) -C csav status

csav-up:
	$(MAKE) -C csav up

csav-down:
	$(MAKE) -C csav down

csav-ssh:
	$(MAKE) -C csav ssh
