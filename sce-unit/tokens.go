package main

import (
	"log"
	"sync"
	"time"
)

const (
	refreshMargin       = 30 * time.Second
	refreshRetryBackoff = 10 * time.Second
)

type tokenPair struct {
	AccessToken          string
	RefreshToken         string
	AccessTokenExpiresAt time.Time
}

// currentTokens holds the live access/refresh token pair, kept fresh by refreshLoop.
var currentTokens struct {
	mu   sync.RWMutex
	pair tokenPair
	set  bool
}

func setTokens(tp tokenPair) {
	currentTokens.mu.Lock()
	defer currentTokens.mu.Unlock()
	currentTokens.pair = tp
	currentTokens.set = true
}

func getTokens() (tokenPair, bool) {
	currentTokens.mu.RLock()
	defer currentTokens.mu.RUnlock()
	return currentTokens.pair, currentTokens.set
}

func CurrentAccessToken() (string, bool) {
	tp, ok := getTokens()
	if !ok {
		return "", false
	}
	return tp.AccessToken, true
}

func refreshLoop(cfg runConfig) {
	for {
		tp, ok := getTokens()
		if !ok {
			time.Sleep(refreshRetryBackoff)
			continue
		}

		wait := time.Until(tp.AccessTokenExpiresAt) - refreshMargin
		if wait > 0 {
			time.Sleep(wait)
		}

		newTp, err := refreshTokens(cfg, tp.RefreshToken)
		if err != nil {
			log.Printf("sce-unit: token refresh failed, retrying in %s: %v", refreshRetryBackoff, err)
			time.Sleep(refreshRetryBackoff)
			continue
		}

		setTokens(newTp)
		log.Printf("sce-unit: refreshed access token, expires %s", newTp.AccessTokenExpiresAt.Format(time.RFC3339))
	}
}
