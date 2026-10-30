package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"quant_bot/paperstate"
)

func readPaper(t *testing.T, path string) paperstate.State {
	t.Helper()
	s, _, err := paperstate.ReadSnapshot(path)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func paperProcess(path, steps string) *exec.Cmd {
	cmd := exec.Command(os.Args[0], "-test.run=^TestPaperResumeHelper$")
	cmd.Env = append(os.Environ(), "QUANT_PAPER_TEST_PATH="+path, "QUANT_PAPER_TEST_STEPS="+steps)
	return cmd
}
func TestPaperAbruptExitAndStaleLockRecovery(t *testing.T) {
	old := http.DefaultTransport
	http.DefaultTransport = forbiddenNetwork{t}
	defer func() { http.DefaultTransport = old }()
	path := filepath.Join(t.TempDir(), "crash.paper.json")
	if err := runPaperSaved(defaultConfig(), "binance", 103, 0, true, path); err != nil {
		t.Fatal(err)
	}
	cmd := paperProcess(path, "crash")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	deadline := time.Now().Add(10 * time.Second)
	for {
		s, _, err := paperstate.ReadSnapshot(path)
		if err == nil && s.Step == 104 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("child did not checkpoint")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err == nil {
		t.Fatal("expected abnormal exit")
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lock, err := os.ReadFile(path + ".lock")
	if err != nil {
		t.Fatal(err)
	}
	if string(lock) != fmt.Sprintln(cmd.Process.Pid) {
		t.Fatal("wrong lock owner")
	}
	if err := runPaperSaved(defaultConfig(), "binance", 11, 0, true, path); err == nil {
		t.Fatal("stale lock bypassed")
	}
	after, _ := os.ReadFile(path)
	lockAfter, _ := os.ReadFile(path + ".lock")
	if !bytes.Equal(before, after) || !bytes.Equal(lock, lockAfter) {
		t.Fatal("blocked startup changed state")
	}
	// Only this temporary lock is archived, after Kill + Wait proves its owner stopped.
	if err := os.Rename(path+".lock", path+".lock.stopped"); err != nil {
		t.Fatal(err)
	}
	if out, err := paperProcess(path, "11").CombinedOutput(); err != nil {
		t.Fatalf("restart: %v %s", err, out)
	}
	full := filepath.Join(t.TempDir(), "full.paper.json")
	if err := runPaperSaved(defaultConfig(), "binance", 115, 0, true, full); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(readPaper(t, path), readPaper(t, full)) {
		t.Fatal("crash recovery differs from uninterrupted simulation")
	}
}

func TestPaperCorruptStartupPreservesEvidence(t *testing.T) {
	old := http.DefaultTransport
	http.DefaultTransport = forbiddenNetwork{t}
	defer func() { http.DefaultTransport = old }()
	for _, raw := range []string{`{"kind":"paper"`, `null`, `{}`, `{"kind":"testnet"}`} {
		t.Run(raw, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "corrupt.paper.json")
			if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
			if err := runPaperSaved(defaultConfig(), "binance", 1, 0, true, path); err == nil {
				t.Fatal("corruption accepted")
			}
			after, err := os.ReadFile(path)
			if err != nil || string(after) != raw {
				t.Fatal("corruption silently reset")
			}
			if _, err := os.Stat(path + ".lock"); !os.IsNotExist(err) {
				t.Fatal("failed startup left lock")
			}
		})
	}
}

type paperMarketMock func(*http.Request) (*http.Response, error)

func (f paperMarketMock) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestPaperDuplicateAndOlderCandlesAcrossRestart(t *testing.T) {
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	path := filepath.Join(t.TempDir(), "dedup.paper.json")
	candles := generateSampleCandles(205, 30000)
	current := append([]Candle(nil), candles[103:203]...)
	calls := 0
	http.DefaultTransport = paperMarketMock(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v3/klines" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		rows := make([][]any, len(current))
		for i, c := range current {
			rows[i] = []any{c.OpenTime, c.Open, c.High, c.Low, c.Close, c.Volume}
		}
		raw, _ := json.Marshal(rows)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: make(http.Header)}, nil
	})
	run := func(n int) {
		t.Helper()
		if err := runPaperSaved(defaultConfig(), "binance", n, 0, false, path); err != nil {
			t.Fatal(err)
		}
	}
	run(1)
	initial := readPaper(t, path)
	if initial.Position == nil {
		t.Fatal("fixture did not create simulated position")
	}
	// Duplicate/older market updates would trigger a stop if processed again.
	current[len(current)-1].Low = 0
	run(2)
	current[len(current)-1].OpenTime--
	run(1)
	if !reflect.DeepEqual(initial, readPaper(t, path)) {
		t.Fatal("duplicate changed position/cash/progress")
	}
	// In the same process skip an old candle, then process one new candle.
	base := http.DefaultTransport
	n := 0
	http.DefaultTransport = paperMarketMock(func(r *http.Request) (*http.Response, error) {
		n++
		if n == 2 {
			current = append([]Candle(nil), candles[104:204]...)
		}
		return base.RoundTrip(r)
	})
	run(2)
	result := readPaper(t, path)
	if result.Step != 2 || result.LastCandle != candles[203].OpenTime {
		t.Fatalf("polling attempts counted as candles: %+v", result)
	}
	before, _ := os.ReadFile(path)
	run(1)
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("restart repeated committed candle")
	}
	if calls != 7 {
		t.Fatalf("mock calls=%d", calls)
	}
}

func TestPaperUnfinishedTemporaryWriteIgnored(t *testing.T) {
	old := http.DefaultTransport
	http.DefaultTransport = forbiddenNetwork{t}
	defer func() { http.DefaultTransport = old }()
	dir := t.TempDir()
	path := filepath.Join(dir, "session.paper.json")
	if err := runPaperSaved(defaultConfig(), "binance", 103, 0, true, path); err != nil {
		t.Fatal(err)
	}
	// Model an incomplete pre-rename write in an isolated directory only.
	orphan := filepath.Join(dir, ".paper-interrupted")
	if err := os.WriteFile(orphan, []byte(`{"kind":"paper"`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runPaperSaved(defaultConfig(), "binance", 12, 0, true, path); err != nil {
		t.Fatal(err)
	}
	full := filepath.Join(t.TempDir(), "full.paper.json")
	if err := runPaperSaved(defaultConfig(), "binance", 115, 0, true, full); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(readPaper(t, path), readPaper(t, full)) {
		t.Fatal("uncommitted temp file affected recovery")
	}
	raw, err := os.ReadFile(orphan)
	if err != nil || string(raw) != `{"kind":"paper"` {
		t.Fatal("orphan evidence removed")
	}
}
