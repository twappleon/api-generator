package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"
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

func TestOfflinePaperExercisesBuyAndSellWithoutNetwork(t *testing.T) {
	oldTransport := http.DefaultTransport
	http.DefaultTransport = forbiddenNetwork{t}
	defer func() { http.DefaultTransport = oldTransport }()
	capture, err := os.CreateTemp(t.TempDir(), "paper-output")
	if err != nil {
		t.Fatal(err)
	}
	defer capture.Close()
	oldStdout := os.Stdout
	os.Stdout = capture
	defer func() { os.Stdout = oldStdout }()
	if err := runPaper(defaultConfig(), "binance", 300, 0, true); err != nil {
		t.Fatal(err)
	}
	os.Stdout = oldStdout
	raw, err := os.ReadFile(capture.Name())
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, want := range []string{"action=BUY", "action=SELL (take_profit)", "[300/300]", "Paper trading finished."} {
		if !strings.Contains(text, want) {
			t.Fatalf("simulation did not exercise %s", want)
		}
	}
}
