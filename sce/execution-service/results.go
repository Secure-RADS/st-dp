package main

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// runResult mirrors the item the consumer Lambda (result-consumer) writes to the RunResults table.
type runResult struct {
	RunId       string `dynamodbav:"RunId" json:"runId"`
	InstanceId  string `dynamodbav:"InstanceId" json:"instanceId"`
	AlgorithmId string `dynamodbav:"AlgorithmId" json:"algorithmId"`
	Status      string `dynamodbav:"Status" json:"status"`
	Output      string `dynamodbav:"Output" json:"output"`
	Diag        any    `dynamodbav:"Diag" json:"diag,omitempty"`
	ReceivedAt  string `dynamodbav:"ReceivedAt" json:"receivedAt"`
}

// getRunResult looks up a run's result by runId; found is false when nothing has been written yet.
func getRunResult(ctx context.Context, runId string) (*runResult, bool, error) {
	key, err := attributevalue.MarshalMap(struct {
		RunId string `dynamodbav:"RunId"`
	}{RunId: runId})
	if err != nil {
		return nil, false, err
	}

	out, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &runResultsTable,
		Key:       key,
	})
	if err != nil {
		return nil, false, err
	}
	if out.Item == nil {
		return nil, false, nil
	}

	var res runResult
	if err := attributevalue.UnmarshalMap(out.Item, &res); err != nil {
		return nil, false, err
	}
	return &res, true, nil
}
