package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	scev1 "sce-unit/gen/scev1"

	sharedlog "github.com/Secure-RADS/st-dp/packages/go-common/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// dataAccessServer serves the DC app over an AF_UNIX socket inside the enclave. Attestation, record fetch,
// and decryption are triggered by the app's FetchRecords call rather than run before nsjail starts.
type dataAccessServer struct {
	scev1.UnimplementedDataAccessServer

	cfg         runConfig
	timelineLog *sharedlog.Client
	runID       string
	limit       int

	fetchOnce  sync.Once
	records    []*scev1.Record
	subjectIDs []string
	fetchErr   error

	subjectMu  sync.Mutex
	submitOnce sync.Once
	submitted  chan struct{}
	result     *structpb.Struct
}

func newDataAccessServer(cfg runConfig, timelineLog *sharedlog.Client, runID string, limit int) *dataAccessServer {
	return &dataAccessServer{
		cfg:         cfg,
		timelineLog: timelineLog,
		runID:       runID,
		limit:       limit,
		submitted:   make(chan struct{}),
	}
}

func (s *dataAccessServer) FetchRecords(_ *scev1.FetchRecordsRequest, stream scev1.DataAccess_FetchRecordsServer) error {
	records, err := s.fetch()
	if err != nil {
		return status.Errorf(codes.Internal, "fetch records: %v", err)
	}
	for _, record := range records {
		if err := stream.Send(record); err != nil {
			return err
		}
	}
	return nil
}

func (s *dataAccessServer) SubmitResult(_ context.Context, req *scev1.SubmitResultRequest) (*scev1.SubmitResultResponse, error) {
	if req.GetResult() == nil {
		return nil, status.Error(codes.InvalidArgument, "result is empty")
	}
	s.submitOnce.Do(func() {
		s.result = req.GetResult()
		close(s.submitted)
	})
	return &scev1.SubmitResultResponse{}, nil
}

func (s *dataAccessServer) submittedResult() *structpb.Struct {
	select {
	case <-s.submitted:
		return s.result
	default:
		return nil
	}
}

// fetch runs at most once: the first FetchRecords triggers attestation and pulls the dataset, and retries
// reuse the outcome so a reconnecting client cannot fetch twice.
func (s *dataAccessServer) fetch() ([]*scev1.Record, error) {
	s.fetchOnce.Do(func() {
		records, subjectIDs, err := s.loadRecords()
		s.records, s.fetchErr = records, err
		s.subjectMu.Lock()
		s.subjectIDs = subjectIDs
		s.subjectMu.Unlock()
	})
	return s.records, s.fetchErr
}

func (s *dataAccessServer) loadRecords() ([]*scev1.Record, []string, error) {
	tp, err := attest(s.cfg, s.runID)
	if err != nil {
		return nil, nil, fmt.Errorf("attestation failed: %w", err)
	}
	log.Printf("sce-unit: attested successfully, access token expires %s", tp.AccessTokenExpiresAt.Format(time.RFC3339))
	setTokens(tp)
	go refreshLoop(s.cfg, s.runID)
	s.timelineLog.EmitEvent(s.cfg.AlgorithmId, &s.runID, sharedlog.EventAttested, nil)

	records, subjectIDs, err := fetchAllRecords(s.cfg, s.limit)
	if err != nil {
		return nil, nil, fmt.Errorf("fetch records: %w", err)
	}
	log.Printf("sce-unit: fetched %d records from pdm-service", len(records))
	s.timelineLog.EmitEvent(s.cfg.AlgorithmId, &s.runID, sharedlog.EventRecordsFetched, map[string]any{"count": len(records)})

	dek, err := decryptDataKey(s.cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("decrypt data key: %w", err)
	}
	log.Printf("sce-unit: unwrapped data key via kms-service (%d bytes)", len(dek))

	out := make([]*scev1.Record, 0, len(records))
	for _, rec := range records {
		data, derr := decryptRecord(dek, rec.Data)
		if derr != nil {
			return nil, nil, fmt.Errorf("decrypt record %s: %w", rec.RecordId, derr)
		}
		out = append(out, &scev1.Record{RecordId: rec.RecordId, Data: data})
	}
	s.timelineLog.EmitEvent(s.cfg.AlgorithmId, &s.runID, sharedlog.EventRecordsDecrypted, map[string]any{"count": len(out)})
	s.timelineLog.EmitEvent(s.cfg.AlgorithmId, &s.runID, sharedlog.EventRecordsStoredLocally, nil)

	return out, uniqueIDs(subjectIDs), nil
}

func (s *dataAccessServer) dataSubjects() []string {
	s.subjectMu.Lock()
	defer s.subjectMu.Unlock()
	return s.subjectIDs
}

// serveRPC listens on the unix socket the jailed DC app connects to and returns the running server.
func serveRPC(socketPath string, server *dataAccessServer) (*grpc.Server, net.Listener, error) {
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, nil, fmt.Errorf("listen on %s: %w", socketPath, err)
	}
	grpcServer := grpc.NewServer()
	scev1.RegisterDataAccessServer(grpcServer, server)
	go func() {
		if err := grpcServer.Serve(listener); err != nil {
			log.Printf("sce-unit: grpc server stopped: %v", err)
		}
	}()
	log.Printf("sce-unit: serving DataAccess on %s", socketPath)
	return grpcServer, listener, nil
}
