package main

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type algorithmRecord struct {
	AlgorithmId string `dynamodbav:"AlgorithmId"`
	S3Bucket    string `dynamodbav:"S3Bucket"`
	S3Key       string `dynamodbav:"S3Key"`
}

func getAlgorithm(ctx context.Context, algorithmId string) (algorithmRecord, error) {
	key, err := attributevalue.MarshalMap(struct {
		AlgorithmId string `dynamodbav:"AlgorithmId"`
	}{AlgorithmId: algorithmId})
	if err != nil {
		return algorithmRecord{}, err
	}

	out, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &dynamoTable,
		Key:       key,
	})
	if err != nil {
		return algorithmRecord{}, err
	}
	if out.Item == nil {
		return algorithmRecord{}, fmt.Errorf("algorithmId %s not found", algorithmId)
	}

	var rec algorithmRecord
	if err := attributevalue.UnmarshalMap(out.Item, &rec); err != nil {
		return algorithmRecord{}, err
	}
	return rec, nil
}
