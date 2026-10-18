package main

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type algorithmRecord struct {
	AlgorithmId string `dynamodbav:"AlgorithmId"`
	S3Bucket    string `dynamodbav:"S3Bucket"`
	S3Key       string `dynamodbav:"S3Key"`
	KmsKeyArn   string `dynamodbav:"KmsKeyArn"`
}

func getAlgorithm(ctx context.Context, algorithmId string) (algorithmRecord, bool, error) {
	out, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &dynamoTable,
		Key: map[string]types.AttributeValue{
			"AlgorithmId": &types.AttributeValueMemberS{Value: algorithmId},
		},
	})
	if err != nil {
		return algorithmRecord{}, false, err
	}
	if out.Item == nil {
		costEvent(algorithmId, serviceDynamoDB, opDynamoRead, 1)
		return algorithmRecord{}, false, nil
	}
	var record algorithmRecord
	if err := attributevalue.UnmarshalMap(out.Item, &record); err != nil {
		return algorithmRecord{}, false, err
	}
	// Estimate item size from the string values plus 64 bytes for attribute names and DynamoDB encoding overhead.
	costEvent(algorithmId, serviceDynamoDB, opDynamoRead, float64(len(record.AlgorithmId)+len(record.S3Bucket)+len(record.S3Key)+len(record.KmsKeyArn)+64))
	return record, true, nil
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
