package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// The enclave host POSTs its result to /result/<instance-id> as its last act
// before self-terminating; /run blocks on the matching channel until then.
const resultTimeout = 10 * time.Minute

type runResult struct {
	Status string `json:"status"`
	Output string `json:"output"`
}

var (
	pendingMu sync.Mutex
	pending   = map[string]chan runResult{}
)

func registerRun(instanceId string) chan runResult {
	ch := make(chan runResult, 1)
	pendingMu.Lock()
	pending[instanceId] = ch
	pendingMu.Unlock()
	return ch
}

func unregisterRun(instanceId string) {
	pendingMu.Lock()
	delete(pending, instanceId)
	pendingMu.Unlock()
}

// deliverResult hands the callback payload to the waiting /run handler;
// false means no run is waiting for that instance (unknown or timed out).
func deliverResult(instanceId string, res runResult) bool {
	pendingMu.Lock()
	ch, ok := pending[instanceId]
	pendingMu.Unlock()
	if ok {
		ch <- res
	}
	return ok
}

func waitForResult(ctx context.Context, instanceId string, ch chan runResult) (*runResult, error) {
	select {
	case res := <-ch:
		return &res, nil
	case <-time.After(resultTimeout):
		return nil, fmt.Errorf("timed out after %s waiting for result from %s", resultTimeout, instanceId)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
