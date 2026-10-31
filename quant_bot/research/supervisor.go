package research

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"quant_bot/paperstate"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Supervisor status is separate from both the ledger and worker heartbeat.
type Supervisor struct {
	Version     int
	State       string
	Heartbeat   int64
	Restarts    int
	ChildPID    int
	RecoveredAt int64
}

func ReadSupervisor(path string) (Supervisor, error) {
	var s Supervisor
	f, e := os.Open(path + ".supervisor.json")
	if e != nil {
		return s, e
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil {
		return s, err
	}
	if len(raw) > 4096 {
		return s, errors.New("supervisor status too large")
	}
	e = json.Unmarshal(raw, &s)
	if e != nil {
		return s, e
	}
	if s.Version != 1 || s.Heartbeat <= 0 || s.Restarts < 0 || s.ChildPID < 0 || s.RecoveredAt < 0 {
		return s, errors.New("invalid supervisor")
	}
	switch s.State {
	case "starting", "watching", "restarting", "stopped", "failed":
	default:
		return s, errors.New("invalid supervisor state")
	}
	return s, nil
}

// Only archive the lock left by our own reaped child; never unlock an unknown writer.
func archiveChildLock(path string, pid int) error {
	lock := path + ".lock"
	info, e := os.Lstat(lock)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	if !info.Mode().IsRegular() {
		return errors.New("nonregular child lock")
	}
	raw, e := os.ReadFile(lock)
	if e != nil {
		return e
	}
	if strings.TrimSpace(string(raw)) != strconv.Itoa(pid) {
		return errors.New("child lock owner mismatch")
	}
	if e = syscall.Kill(pid, 0); e != syscall.ESRCH {
		return errors.New("child PID still exists or cannot verify")
	}
	current, e := os.Lstat(lock)
	if e != nil || !os.SameFile(info, current) {
		return errors.New("child lock changed")
	}
	return os.Rename(lock, fmt.Sprintf("%s.reaped-%d-%d", lock, pid, time.Now().UnixNano()))
}

// Supervise only restarts signaled/panicked children, never deliberate safety exits.
func Supervise(ctx context.Context, path, config string, slip float64, interval time.Duration) error {
	binary, e := os.Executable()
	if e != nil {
		return e
	}
	return supervise(ctx, path, func() *exec.Cmd {
		return exec.Command(binary, "--mode", "paper", "--config", config, "--state", path, "--slippage-bps", strconv.FormatFloat(slip, 'f', -1, 64), "--polls", "0", "--poll-every", interval.String())
	}, 5*time.Second)
}
func supervise(ctx context.Context, path string, command func() *exec.Cmd, backoff time.Duration) error {
	if !strings.HasSuffix(path, ".performance.paper.json") {
		return errors.New("isolated performance path required")
	}
	return paperstate.WithLock(path+".supervisor.paper.json", func() (result error) {
		// Existing worker/stale locks require explicit operator diagnosis on initial startup.
		if _, e := os.Lstat(path + ".lock"); e == nil {
			return errors.New("existing worker lock; inspect before supervising")
		} else if !os.IsNotExist(e) {
			return e
		}
		status := Supervisor{Version: 1, State: "starting"}
		var childStarted int64
		save := func() error {
			status.Heartbeat = time.Now().UnixMilli()
			raw, e := json.Marshal(status)
			if e != nil {
				return e
			}
			return paperstate.WriteAtomic(path+".supervisor.json", raw)
		}
		defer func() {
			status.State = "stopped"
			status.ChildPID = 0
			if result != nil && !errors.Is(result, context.Canceled) {
				status.State = "failed"
			}
			result = errors.Join(result, save())
		}()
		var crashes []time.Time
		for {
			if e := ctx.Err(); e != nil {
				return e
			}
			status.State = "starting"
			if e := save(); e != nil {
				return e
			}
			cmd := command()
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			if e := cmd.Start(); e != nil {
				return e
			}
			childStarted = time.Now().UnixMilli()
			status.ChildPID = cmd.Process.Pid
			status.State = "watching"
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			stop := func() {
				_ = cmd.Process.Signal(syscall.SIGTERM)
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					_ = cmd.Process.Kill()
					<-done
				}
			}
			if e := save(); e != nil {
				stop()
				return e
			}
			ticker := time.NewTicker(time.Second)
			var childErr error
			running := true
			for running {
				select {
				case <-ctx.Done():
					stop()
					ticker.Stop()
					return ctx.Err()
				case childErr = <-done:
					running = false
				case <-ticker.C:
					if status.Restarts > 0 && status.RecoveredAt == 0 {
						if r, e := ReadRuntime(path); e == nil && r.LastSuccess >= childStarted && r.Failures == 0 {
							status.RecoveredAt = r.LastSuccess
						}
					}
					if e := save(); e != nil {
						stop()
						ticker.Stop()
						return e
					}
				}
			}
			ticker.Stop()
			pid := status.ChildPID
			status.ChildPID = 0
			if childErr == nil {
				return nil
			}
			var exit *exec.ExitError
			if !errors.As(childErr, &exit) {
				return childErr
			}
			ws, ok := exit.Sys().(syscall.WaitStatus)
			if !ok || (!ws.Signaled() && exit.ExitCode() != 2) {
				return errors.New("Paper safety exit; manual inspection required")
			}
			now := time.Now()
			kept := crashes[:0]
			for _, t := range crashes {
				if now.Sub(t) < 10*time.Minute {
					kept = append(kept, t)
				}
			}
			crashes = append(kept, now)
			if len(crashes) > 5 {
				return errors.New("Paper crash budget exceeded; inspect before restart")
			}
			if e := archiveChildLock(path, pid); e != nil {
				return e
			}
			status.Restarts++
			status.RecoveredAt = 0
			status.State = "restarting"
			if e := save(); e != nil {
				return e
			}
			// Capped delay, interruptible; status remains fresh during the wait.
			until := time.Now().Add(backoff * time.Duration(len(crashes)))
			for time.Now().Before(until) {
				d := time.Until(until)
				if d > time.Second {
					d = time.Second
				}
				if e := waitContext(ctx, d); e != nil {
					return e
				}
				if e := save(); e != nil {
					return e
				}
			}
		}
	})
}
