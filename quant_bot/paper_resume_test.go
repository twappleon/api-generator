package main

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	"quant_bot/paperstate"
)

func TestPaperResumeIndependentProcess(t *testing.T) {
	dir := t.TempDir()
	split := filepath.Join(dir, "split.paper.json")
	full := filepath.Join(dir, "full.paper.json")
	run := func(path, steps string) {
		t.Helper()
		cmd := exec.Command(os.Args[0], "-test.run=^TestPaperResumeHelper$")
		cmd.Env = append(os.Environ(), "QUANT_PAPER_TEST_PATH="+path, "QUANT_PAPER_TEST_STEPS="+steps)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("subprocess: %v %s", err, out)
		}
	}
	read := func(path string) paperstate.State {
		t.Helper()
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var s paperstate.State
		if err = json.Unmarshal(raw, &s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	run(split, "103")
	before := read(split)
	if before.Position == nil || before.Step != 103 {
		t.Fatal("did not persist open position")
	}
	run(split, "12")
	resumed := read(split)
	run(full, "115")
	if !reflect.DeepEqual(resumed, read(full)) {
		t.Fatal("restart result differs from uninterrupted run")
	}
	if resumed.Position != nil || resumed.Cash <= 1000 || resumed.Step != 115 || resumed.LastCandle <= before.LastCandle {
		t.Fatalf("position/cash/progress not resumed: %+v", resumed)
	}
}
func TestPaperResumeHelper(t *testing.T) {
	path := os.Getenv("QUANT_PAPER_TEST_PATH")
	if path == "" {
		t.Skip("subprocess only")
	}
	steps := map[string]int{"103": 103, "12": 12, "115": 115}[os.Getenv("QUANT_PAPER_TEST_STEPS")]
	if steps == 0 {
		t.Fatal("bad test steps")
	}
	http.DefaultTransport = forbiddenNetwork{t}
	if err := runPaperSaved(defaultConfig(), "binance", steps, 0, true, path); err != nil {
		t.Fatal(err)
	}
}
func TestPaperConfigMismatchPreservesSnapshot(t *testing.T) {
	old := http.DefaultTransport
	http.DefaultTransport = forbiddenNetwork{t}
	defer func() { http.DefaultTransport = old }()
	path := filepath.Join(t.TempDir(), "session.paper.json")
	if err := runPaperSaved(defaultConfig(), "binance", 1, 0, true, path); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	cfg := defaultConfig()
	cfg.FeeRate *= 2
	if err := runPaperSaved(cfg, "binance", 1, 0, true, path); err == nil {
		t.Fatal("changed strategy silently resumed")
	}
	if err := runPaperSaved(defaultConfig(), "binance", 1, 0, false, path); err == nil {
		t.Fatal("offline snapshot reused for live data")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("mismatch rewrote snapshot")
	}
}
