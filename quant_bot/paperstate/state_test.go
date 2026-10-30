package paperstate

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStateIsolationLockAndAtomicSave(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.paper.json")
	testnet := filepath.Join(dir, "state-testnet.json")
	original := []byte(`{"kill":true,"orders":{"x":"PENDING_UNKNOWN"}}`)
	_ = os.WriteFile(testnet, original, 0600)
	if err := WithLock(testnet, func() error { t.Fatal("entered Testnet state"); return nil }); err == nil {
		t.Fatal("Testnet path accepted")
	}
	if err := WithLock(path, func() error {
		if err := WithLock(path, func() error { t.Fatal("second writer entered"); return nil }); err == nil {
			t.Fatal("missing exclusion")
		}
		return Save(path, State{Kind: "paper", Version: 1, Config: "config", Cash: 1000})
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".lock"); !os.IsNotExist(err) {
		t.Fatal("lock not released")
	}
	before, _ := os.ReadFile(path)
	if err := Save(path, State{Kind: "paper", Version: 1, Config: "config", Cash: -1}); err == nil {
		t.Fatal("negative cash accepted")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("failed save damaged snapshot")
	}
	data, _ := os.ReadFile(testnet)
	if string(data) != string(original) {
		t.Fatal("Testnet ledger changed")
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("snapshot permissions")
	}
	t.Setenv("BINANCE_TESTNET_STATE", path)
	if err := WithLock(path, func() error { t.Fatal("shared Testnet path accepted"); return nil }); err == nil {
		t.Fatal("shared path accepted")
	}
}
func TestMalformedSnapshotsNeverReset(t *testing.T) {
	for _, body := range []string{`{"kind":"paper","version":1,"config":"c","cash":null,"position":null,"step":0,"last_candle":0}`, `null`, `{}`, `{broken`, `{"kill":true}`, `{"kind":"paper","version":2,"config":"c","cash":1}`, `{"kind":"paper","version":1,"config":"c","cash":-1}`, `{"kind":"paper","version":1,"config":"c","cash":1,"position":{"Qty":-1}}`} {
		path := filepath.Join(t.TempDir(), "s.paper.json")
		_ = os.WriteFile(path, []byte(body), 0600)
		if _, err := Load(path, "c", 1000); err == nil {
			t.Errorf("accepted %s", body)
		}
		after, _ := os.ReadFile(path)
		if string(after) != body {
			t.Fatal("invalid state reset")
		}
	}
}

func TestSaveFilesystemFailuresPreserveCommittedSnapshot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("permission failure requires non-root user")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "session.paper.json")
	state := State{Kind: "paper", Version: 1, Config: "config", Cash: 1000}
	if err := Save(path, state); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0500); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(dir, 0700)
	state.Cash = 900
	if err := Save(path, state); err == nil {
		t.Fatal("read-only directory accepted checkpoint")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatal("failed checkpoint replaced committed data")
	}
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	// A directory at the target makes rename fail after the temporary file is synced.
	target := filepath.Join(dir, "blocked.paper.json")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	if err := Save(target, state); err == nil {
		t.Fatal("rename over directory succeeded")
	}
	temps, err := filepath.Glob(filepath.Join(dir, ".paper-*"))
	if err != nil || len(temps) != 0 {
		t.Fatal("failed save leaked temporary file")
	}
	after, err = os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatal("rename failure damaged previous snapshot")
	}
	if err := Save(path, state); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path, "config", 1000)
	if err != nil || restored.Cash != 900 {
		t.Fatal("could not save after filesystem recovered")
	}
}

func TestLockCleanupFailureIsReported(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("permission failure requires non-root user")
	}
	for _, failCallback := range []bool{false, true} {
		dir := t.TempDir()
		path := filepath.Join(dir, "session.paper.json")
		original := errors.New("original checkpoint error")
		err := WithLock(path, func() error {
			if err := os.Chmod(dir, 0500); err != nil {
				t.Fatal(err)
			}
			if failCallback {
				return original
			}
			return nil
		})
		if restoreErr := os.Chmod(dir, 0700); restoreErr != nil {
			t.Fatal(restoreErr)
		}
		if err == nil || !strings.Contains(err.Error(), "lock cleanup failed") {
			t.Fatalf("cleanup failure hidden: %v", err)
		}
		if failCallback && !errors.Is(err, original) {
			t.Fatal("original error lost")
		}
		if _, err := os.Stat(path + ".lock"); err != nil {
			t.Fatal("missing residual lock")
		}
		if err := WithLock(path, func() error { t.Fatal("residual lock bypassed"); return nil }); err == nil {
			t.Fatal("restart accepted")
		}
	}
}
