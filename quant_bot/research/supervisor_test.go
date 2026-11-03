package research

import (
	"context"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"quant_bot/paperstate"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestSupervisedChildHelper(t *testing.T) {
	path := os.Getenv("PAPER_HELPER_PATH")
	if path == "" {
		return
	}
	mode := os.Getenv("PAPER_HELPER_MODE")
	if mode == "wait" {
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
		defer stop()
		e := paperstate.WithLock(path, func() error { <-ctx.Done(); return nil })
		if e != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	if mode == "fatal" {
		os.Exit(1)
	}
	if mode == "crash" {
		_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
		return
	}
	err := paperstate.WithLock(path, func() error {
		s, e := Read(path)
		if e != nil {
			return e
		}
		if s.Steps == 0 {
			if _, e = s.Apply(candle(5, 4)); e != nil {
				return e
			}
			if e = Save(path, s); e != nil {
				return e
			}
			_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
			select {}
		}
		if changed, e := s.Apply(candle(5, 4)); e != nil || changed {
			os.Exit(1)
		}
		if _, e = s.Apply(candle(6, 3)); e != nil {
			return e
		}
		if e = Save(path, s); e != nil {
			return e
		}
		return runLoop(context.Background(), config(), path, 1, time.Second, func() error { return nil }, time.Now, waitContext)
	})
	if err != nil {
		os.Exit(1)
	}
	time.Sleep(1200 * time.Millisecond)
	os.Exit(0)
}
func helper(path, mode string) func() *exec.Cmd {
	return func() *exec.Cmd {
		c := exec.Command(os.Args[0], "-test.run=^TestSupervisedChildHelper$")
		c.Env = append(os.Environ(), "PAPER_HELPER_PATH="+path, "PAPER_HELPER_MODE="+mode)
		return c
	}
}
func TestSupervisorActualKillResumeNoDuplicate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	initial := seeded(t)
	if e := Save(path, initial); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if e := supervise(ctx, path, helper(path, "resume"), time.Millisecond); e != nil {
		t.Fatal(e)
	}
	got, e := Read(path)
	if e != nil {
		t.Fatal(e)
	}
	for _, b := range []Candle{candle(5, 4), candle(6, 3)} {
		if _, e = initial.Apply(b); e != nil {
			t.Fatal(e)
		}
	}
	if !reflect.DeepEqual(initial, got) {
		t.Fatal("crash/restart differs from continuous processing")
	}
	sup, e := ReadSupervisor(path)
	if e != nil || sup.Restarts != 1 || sup.State != "stopped" || sup.RecoveredAt == 0 {
		t.Fatalf("%+v %v", sup, e)
	}
	locks, _ := filepath.Glob(path + ".lock.reaped-*")
	if len(locks) != 1 {
		t.Fatal(locks)
	}
	if _, e = os.Stat(path + ".lock"); !os.IsNotExist(e) {
		t.Fatal("worker lock remains")
	}
}
func TestSupervisorSafetyExitAndCrashBudget(t *testing.T) {
	for _, mode := range []string{"fatal", "crash"} {
		path := filepath.Join(t.TempDir(), "live.performance.paper.json")
		Save(path, seeded(t))
		before, _ := os.ReadFile(path)
		e := supervise(context.Background(), path, helper(path, mode), time.Millisecond)
		if e == nil {
			t.Fatal("unexpected success")
		}
		sup, _ := ReadSupervisor(path)
		want := 0
		if mode == "crash" {
			want = 5
		}
		if sup.Restarts != want || sup.State != "failed" {
			t.Fatal(sup)
		}
		after, _ := os.ReadFile(path)
		if string(before) != string(after) {
			t.Fatal("safety failure changed ledger")
		}
	}
}
func TestSupervisorRefusesForeignLocks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	os.WriteFile(path+".lock", []byte("1\n"), 0600)
	if e := supervise(context.Background(), path, func() *exec.Cmd { t.Fatal("launched despite existing lock"); return nil }, time.Millisecond); e == nil {
		t.Fatal("existing lock accepted")
	}
	if e := archiveChildLock(path, 999999); e == nil {
		t.Fatal("foreign owner accepted")
	}
	b, _ := os.ReadFile(path + ".lock")
	if string(b) != "1\n" {
		t.Fatal("foreign lock changed")
	}
}
func TestPaperLongRunDuplicatePolling(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	s := seeded(t)
	Save(path, s)
	now := time.Unix(1000, 0)
	calls := 0
	e := runLoop(context.Background(), config(), path, 2000, time.Second, func() error {
		calls++
		r, e := Read(path)
		if e != nil {
			return e
		}
		// Each new candle is delivered twice, using the real state engine and disk checkpoint.
		index := 5 + (calls-1)/2
		if changed, e := r.Apply(candle(index, 4)); e != nil {
			return e
		} else if changed {
			return Save(path, r)
		}
		return nil
	}, func() time.Time { return now }, func(_ context.Context, d time.Duration) error { now = now.Add(d); return nil })
	got, _ := Read(path)
	if e != nil || got.Steps != 1000 || got.Last != 1004*60000 {
		t.Fatalf("%v steps=%d last=%d", e, got.Steps, got.Last)
	}
	r, _ := ReadRuntime(path)
	if r.State != "stopped" || r.Failures != 0 {
		t.Fatal(r)
	}
}
func TestSupervisorCancelledWait(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	e := supervise(ctx, path, helper(path, "crash"), time.Minute)
	if e == nil || !strings.Contains(e.Error(), "deadline") {
		t.Fatal(e)
	}
}

func TestSupervisorCancellationStopsChild(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- supervise(ctx, path, helper(path, "wait"), time.Millisecond) }()
	deadline := time.Now().Add(3 * time.Second)
	pid := 0
	for time.Now().Before(deadline) {
		if r, e := ReadSupervisor(path); e == nil && r.ChildPID > 0 {
			if _, e = os.Stat(path + ".lock"); e == nil {
				pid = r.ChildPID
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	if pid == 0 {
		cancel()
		<-done
		t.Fatal("child not ready")
	}
	cancel()
	if e := <-done; e != context.Canceled && (e == nil || !strings.Contains(e.Error(), "canceled")) {
		t.Fatal(e)
	}
	if e := syscall.Kill(pid, 0); e != syscall.ESRCH {
		t.Fatal("child survived cancellation")
	}
	if _, e := os.Stat(path + ".lock"); !os.IsNotExist(e) {
		t.Fatal("graceful stop left lock")
	}
}
