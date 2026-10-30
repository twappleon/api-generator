package paperstate

import (
	"os"
	"path/filepath"
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
