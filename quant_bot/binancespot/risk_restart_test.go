package binancespot

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestRiskLatchAcrossDayAndProcessRestart(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		equity float64
		reason string
	}{{"daily", 989, "daily loss limit"}, {"drawdown", 940, "max drawdown"}} {
		t.Run(scenario.name, func(t *testing.T) {
			s := State{Orders: map[string]string{"existing": "PENDING_UNKNOWN"}}
			if err := s.Observe("2026-10-30", 1000, limits()); err != nil {
				t.Fatal(err)
			}
			if err := s.Observe("2026-10-30", scenario.equity, limits()); err == nil || !s.Kill || s.KillReason != scenario.reason {
				t.Fatalf("halt missing: %+v %v", s, err)
			}
			before := s
			for _, day := range []string{"2026-10-30", "2026-10-31"} {
				if err := s.Observe(day, 2000, limits()); err == nil {
					t.Fatal("halt cleared")
				}
				if !reflect.DeepEqual(s, before) {
					t.Fatal("halt evidence changed")
				}
			}
			path := filepath.Join(t.TempDir(), "risk.json")
			if err := SaveState(path, s); err != nil {
				t.Fatal(err)
			}
			raw, _ := os.ReadFile(path)
			for i := 0; i < 2; i++ {
				cmd := exec.Command(os.Args[0], "-test.run=^TestRiskRestartHelper$")
				cmd.Env = append(os.Environ(), "QUANT_RISK_RESTART_PATH="+path)
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("fresh process failed: %v %s", err, out)
				}
			}
			after, _ := os.ReadFile(path)
			if string(raw) != string(after) {
				t.Fatal("restart changed persistent state")
			}
		})
	}
}
func TestRiskRestartHelper(t *testing.T) {
	path := os.Getenv("QUANT_RISK_RESTART_PATH")
	if path == "" {
		t.Skip("subprocess only")
	}
	s, err := LoadState(path)
	if err != nil || !s.Kill || s.Orders["existing"] != "PENDING_UNKNOWN" {
		t.Fatalf("lost persisted halt %v", err)
	}
	before := s
	if err = s.Observe("2026-10-31", 2000, limits()); err == nil || !reflect.DeepEqual(s, before) {
		t.Fatal("halt lost after new process/day")
	}
	// An uninitialized client cannot reach any network even if the guard regresses.
	c := &Client{}
	if _, err = c.PlaceGuarded(path, request(), limits()); err == nil || !strings.Contains(err.Error(), "kill switch latched") {
		t.Fatalf("not rejected by persisted halt: %v", err)
	}
}
func TestUnhaltedDayRolloverKeepsPeakAndOrders(t *testing.T) {
	s := State{Orders: map[string]string{"existing": "FILLED"}}
	_ = s.Observe("2026-10-30", 1000, limits())
	if err := s.Observe("2026-10-31", 995, limits()); err != nil {
		t.Fatal(err)
	}
	if s.DayStart != 995 || s.Peak != 1000 || s.Kill || s.Orders["existing"] != "FILLED" {
		t.Fatalf("bad rollover %+v", s)
	}
}
func TestMalformedRiskSnapshotsRemainUntouched(t *testing.T) {
	for _, raw := range []string{`null`, `[]`, `{"day":"bad","day_start":1000}`, `{"day_start":-1}`, `{"peak":-1}`, `{broken`} {
		path := filepath.Join(t.TempDir(), "risk.json")
		_ = os.WriteFile(path, []byte(raw), 0600)
		if _, err := LoadState(path); err == nil {
			t.Errorf("accepted %s", raw)
		}
		after, _ := os.ReadFile(path)
		if string(after) != raw {
			t.Fatal("corrupt state rewritten")
		}
	}
}
