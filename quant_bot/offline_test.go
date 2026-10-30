package main

import (
	"fmt"
	"net/http"
	"testing"
)

type forbiddenNetwork struct{ t *testing.T }

func (f forbiddenNetwork) RoundTrip(*http.Request) (*http.Response, error) {
	f.t.Error("offline simulation attempted network access")
	return nil, fmt.Errorf("network forbidden")
}
func TestOfflineModesNeverUseNetwork(t *testing.T) {
	old := http.DefaultTransport
	http.DefaultTransport = forbiddenNetwork{t}
	defer func() { http.DefaultTransport = old }()
	cfg := defaultConfig()
	if err := runBacktest(cfg, "binance", 300, true); err != nil {
		t.Fatal(err)
	}
	if err := runPaper(cfg, "binance", 5, 0, true); err != nil {
		t.Fatal(err)
	}
}
