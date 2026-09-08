package main

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type algorithmRecord struct {
	AlgorithmId string `dynamodbav:"AlgorithmId"`
	S3Bucket    string `dynamodbav:"S3Bucket"`
	S3Key       string `dynamodbav:"S3Key"`
	KmsKeyArn   string `dynamodbav:"KmsKeyArn"`
}

func putAlgorithm(ctx context.Context, algorithmId, bucket, key, kmsKeyArn string) error {
	item, err := attributevalue.MarshalMap(algorithmRecord{
		AlgorithmId: algorithmId,
		S3Bucket:    bucket,
		S3Key:       key,
		KmsKeyArn:   kmsKeyArn,
	})
	if err != nil {
		return err
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &dynamoTable,
		Item:      item,
	})
	return err
}
