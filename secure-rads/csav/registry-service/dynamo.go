package main

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	sharedcost "github.com/rukshangithub/GDPR/packages/go-common/cost"
)

type algorithmRecord struct {
	AlgorithmId string `dynamodbav:"AlgorithmId"`
	S3Bucket    string `dynamodbav:"S3Bucket"`
	S3Key       string `dynamodbav:"S3Key"`
	KmsKeyArn   string `dynamodbav:"KmsKeyArn"`
}

func getAlgorithm(ctx context.Context, algorithmId string) (algorithmRecord, bool, error) {
	out, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:              &dynamoTable,
		ReturnConsumedCapacity: types.ReturnConsumedCapacityTotal,
		Key: map[string]types.AttributeValue{
			"AlgorithmId": &types.AttributeValueMemberS{Value: algorithmId},
		},
	})
	if err != nil {
		return algorithmRecord{}, false, err
	}
	capacityUnits := 0.0
	if out.ConsumedCapacity != nil && out.ConsumedCapacity.CapacityUnits != nil {
		capacityUnits = *out.ConsumedCapacity.CapacityUnits
	}
	sharedcost.Client{Host: costHost}.Emit(sharedcost.Event{
		AlgorithmID: algorithmId,
		RunID:       algorithmId,
		Phase:       sharedcost.Build,
		Service:     sharedcost.DynamoDB,
		Operation:   sharedcost.DynamoDBReadCapacity,
		Quantity:    capacityUnits,
	})
	if out.Item == nil {
		return algorithmRecord{}, false, nil
	}
	var record algorithmRecord
	if err := attributevalue.UnmarshalMap(out.Item, &record); err != nil {
		return algorithmRecord{}, false, err
	}
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

	out, err := dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:              &dynamoTable,
		Item:                   item,
		ReturnConsumedCapacity: types.ReturnConsumedCapacityTotal,
	})
	if err != nil {
		return err
	}
	capacityUnits := 0.0
	if out.ConsumedCapacity != nil && out.ConsumedCapacity.CapacityUnits != nil {
		capacityUnits = *out.ConsumedCapacity.CapacityUnits
	}
	sharedcost.Client{Host: costHost}.Emit(sharedcost.Event{
		AlgorithmID: algorithmId,
		RunID:       algorithmId,
		Phase:       sharedcost.Build,
		Service:     sharedcost.DynamoDB,
		Operation:   sharedcost.DynamoDBWriteCapacity,
		Quantity:    capacityUnits,
	})
	return nil
}
