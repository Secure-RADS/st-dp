package main

import sharedlog "github.com/rukshangithub/GDPR/packages/go-common/log"

const (
	eventImageUploaded       = "image-uploaded"
	eventBuildStarted        = "build-started"
	eventAlgorithmRegistered = "algorithm-registered"
	eventPcrsRegistered      = "pcrs-registered"
	eventKmsKeyProvisioned   = "kms-key-provisioned"
	eventBuildCompleted      = "build-completed"
	eventBuildFailed         = "build-failed"
)

var timelineLog = &sharedlog.Client{Host: logHost}
