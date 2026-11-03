package research

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"quant_bot/paperstate"
	"time"
)

// RetryError is restricted to transient public market GET failures.
type RetryError struct {
	Message string
	After   time.Duration
}

func (e *RetryError) Error() string { return e.Message }

type Runtime struct {
	Version                           int
	State                             string
	Heartbeat, LastSuccess, NextRetry int64
	Failures                          int
	Restored                          bool
}

func ReadRuntime(path string) (Runtime, error) {
	var r Runtime
	f, e := os.Open(path + ".runtime.json")
	if e != nil {
		return r, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, 4097))
	if e != nil {
		return r, e
	}
	if len(b) > 4096 {
		return r, errors.New("runtime too large")
	}
	if e = json.Unmarshal(b, &r); e != nil {
		return r, e
	}
	switch r.State {
	case "polling", "running", "retrying", "stopped", "failed":
	default:
		return r, errors.New("invalid runtime state")
	}
	if r.Version != 1 || r.Heartbeat <= 0 || r.LastSuccess < 0 || r.NextRetry < 0 || r.Failures < 0 {
		return r, errors.New("invalid runtime")
	}
	return r, nil
}
func waitContext(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
func retryDelay(n int, after time.Duration) time.Duration {
	d := 5 * time.Second
	for i := 1; i < n && d < time.Minute; i++ {
		d *= 2
	}
	if d > time.Minute {
		d = time.Minute
	}
	if after > d {
		d = after
	}
	return d
}

// Called only under the snapshot writer lock. Status never modifies the ledger.
func runLoop(ctx context.Context, c Config, path string, polls int, interval time.Duration, poll func() error, now func() time.Time, wait func(context.Context, time.Duration) error) (result error) {
	r := Runtime{Version: 1, State: "polling"}
	save := func() error {
		r.Heartbeat = now().UnixMilli()
		b, e := json.Marshal(r)
		if e != nil {
			return e
		}
		return paperstate.WriteAtomic(path+".runtime.json", b)
	}
	defer func() {
		r.State = "stopped"
		r.NextRetry = 0
		if result != nil && !errors.Is(result, context.Canceled) {
			r.State = "failed"
		}
		result = errors.Join(result, save())
	}()
	if _, e := Read(path); e == nil {
		r.Restored = true
	} else if !os.IsNotExist(e) {
		return e
	}
	for successes := 0; polls == 0 || successes < polls; {
		if e := ctx.Err(); e != nil {
			return e
		}
		r.State = "polling"
		if e := save(); e != nil {
			return e
		}
		e := poll()
		delay := interval
		if e != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			var transient *RetryError
			if !errors.As(e, &transient) {
				return e
			}
			r.Failures++
			r.State = "retrying"
			delay = retryDelay(r.Failures, transient.After)
			r.NextRetry = now().Add(delay).UnixMilli()
		} else {
			successes++
			r.State = "running"
			r.Failures = 0
			r.NextRetry = 0
			r.LastSuccess = now().UnixMilli()
		}
		if e := save(); e != nil {
			return e
		}
		if polls > 0 && successes >= polls {
			return nil
		}
		// Refresh heartbeat during backoff, including long server Retry-After values.
		for delay > 0 {
			step := delay
			if step > 15*time.Second {
				step = 15 * time.Second
			}
			if e := wait(ctx, step); e != nil {
				return e
			}
			delay -= step
			if e := save(); e != nil {
				return e
			}
		}
	}
	return nil
}
