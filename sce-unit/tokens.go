package main

import (
	"log"
	"sync"
	"time"
)

// refreshMargin is how long before expiry the background loop refreshes, so a reader never observes an
// access token that's about to (or has just) expired.
const refreshMargin = 30 * time.Second

const refreshRetryBackoff = 10 * time.Second

type tokenPair struct {
	AccessToken          string
	RefreshToken         string
	AccessTokenExpiresAt time.Time
}

// currentTokens is process-wide, mutex-guarded state - the one place that holds the live access/refresh token
// pair, kept fresh by refreshLoop and read by anything in sce-unit that needs to authenticate as this run.
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

// CurrentAccessToken returns the access token currently in effect, for anything in sce-unit that needs to
// authenticate a call as this run.
func CurrentAccessToken() (string, bool) {
	tp, ok := getTokens()
	if !ok {
		return "", false
	}
	return tp.AccessToken, true
}

// refreshLoop runs for the lifetime of the process, proactively exchanging the refresh token for a new access
// token shortly before the current one expires, so it never goes stale between reads.
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
