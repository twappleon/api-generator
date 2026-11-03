package research

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestRetryClassificationAndServerDelay(t *testing.T) {
	for _, code := range []int{429, 500, 503, 418, 400, 403, 302} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			m := mockMarket(t, func(*http.Request) *http.Response {
				r := response(nil)
				r.StatusCode = code
				r.Header.Set("Retry-After", "120")
				return r
			})
			_, e := m.Now(context.Background())
			var retry *RetryError
			got := errors.As(e, &retry)
			want := code == 429 || code >= 500
			if got != want {
				t.Fatalf("code %d retry=%v error=%v", code, got, e)
			}
			if got && retry.After != 120*time.Second {
				t.Fatal(retry)
			}
		})
	}
	if retryDelay(100, 0) != time.Minute || retryDelay(2, 0) != 10*time.Second || retryDelay(1, 2*time.Minute) != 2*time.Minute {
		t.Fatal("backoff")
	}
	m := Market{Client: &http.Client{Transport: transport(func(*http.Request) (*http.Response, error) {
		return nil, &net.DNSError{Err: "offline", Name: "redacted"}
	})}}
	_, e := m.Now(context.Background())
	var retry *RetryError
	if !errors.As(e, &retry) {
		t.Fatal(e)
	}
}

func TestRetryRecoveryCheckpointAndRestartNoDuplicate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	s := seeded(t)
	if e := Save(path, s); e != nil {
		t.Fatal(e)
	}
	original, _ := os.ReadFile(path)
	now := time.Unix(1000, 0)
	attempt := 0
	waits := []time.Duration{}
	m := mockMarket(t, func(r *http.Request) *http.Response {
		if r.URL.Path == "/api/v3/time" {
			return response(map[string]int64{"serverTime": 7*60000 + 1000})
		}
		if attempt <= 2 {
			r := response(nil)
			r.StatusCode = 503
			return r
		}
		return response(rows([]Candle{candle(5, 4), candle(6, 3)}))
	})
	poll := func() error { attempt++; return Poll(context.Background(), m, config(), path) }
	wait := func(_ context.Context, d time.Duration) error {
		waits = append(waits, d)
		r, e := ReadRuntime(path)
		if e != nil || r.State != "retrying" || r.Failures != attempt || r.NextRetry <= now.UnixMilli() {
			t.Fatalf("status %+v %v", r, e)
		}
		b, _ := os.ReadFile(path)
		if !bytes.Equal(b, original) {
			t.Fatal("failed fetch mutated checkpoint")
		}
		now = now.Add(d)
		return nil
	}
	if e := runLoop(context.Background(), config(), path, 1, time.Second, poll, func() time.Time { return now }, wait); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(waits, []time.Duration{5 * time.Second, 10 * time.Second}) {
		t.Fatal(waits)
	}
	got, e := Read(path)
	if e != nil {
		t.Fatal(e)
	}
	for _, b := range []Candle{candle(5, 4), candle(6, 3)} {
		if _, e = s.Apply(b); e != nil {
			t.Fatal(e)
		}
	}
	s.Updated = 7*60000 + 1000
	if !reflect.DeepEqual(s, got) {
		t.Fatal("retry replay differs from uninterrupted")
	}
	before, _ := os.ReadFile(path)
	if e := Run(context.Background(), m, config(), path, 1, time.Second); e != nil {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("restart processed duplicate")
	}
	r, e := ReadRuntime(path)
	if e != nil || !r.Restored || r.State != "stopped" || r.Failures != 0 || r.LastSuccess == 0 {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestRuntimeFatalCancelAndLock(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		path := filepath.Join(t.TempDir(), "live.performance.paper.json")
		s := seeded(t)
		Save(path, s)
		before, _ := os.ReadFile(path)
		ctx, cancel := context.WithCancel(context.Background())
		calls := 0
		poll := func() error {
			calls++
			if cancelled {
				return &RetryError{Message: "offline"}
			}
			return errors.New("invalid candle")
		}
		wait := func(context.Context, time.Duration) error { cancel(); return ctx.Err() }
		e := runLoop(ctx, config(), path, 0, time.Second, poll, time.Now, wait)
		cancel()
		if e == nil || calls != 1 {
			t.Fatalf("%v %d", e, calls)
		}
		r, _ := ReadRuntime(path)
		want := "failed"
		if cancelled {
			want = "stopped"
		}
		if r.State != want {
			t.Fatal(r)
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(before, after) {
			t.Fatal("fatal changed state")
		}
		status, _ := os.ReadFile(path + ".runtime.json")
		os.WriteFile(path+".lock", []byte("stale lock"), 0600)
		if e = Run(context.Background(), Market{}, config(), path, 1, time.Second); e == nil {
			t.Fatal("lock bypass")
		}
		statusAfter, _ := os.ReadFile(path + ".runtime.json")
		if !bytes.Equal(status, statusAfter) {
			t.Fatal("contender overwrote runtime")
		}
	}
}
func TestRuntimeWriteFailureStopsBeforePoll(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	os.Mkdir(path+".runtime.json", 0700)
	calls := 0
	e := runLoop(context.Background(), config(), path, 1, time.Second, func() error { calls++; return nil }, time.Now, waitContext)
	if e == nil || calls != 0 {
		t.Fatalf("%v %d", e, calls)
	}
}

func TestRetryHeartbeatLongDelayAndCorruptCheckpoint(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	now := time.Unix(1000, 0)
	calls := 0
	beats := 0
	e := runLoop(context.Background(), config(), path, 1, time.Second, func() error {
		calls++
		if calls == 1 {
			return &RetryError{Message: "rate limit", After: time.Minute}
		}
		return nil
	}, func() time.Time { return now }, func(_ context.Context, d time.Duration) error {
		r, e := ReadRuntime(path)
		if e != nil || r.Heartbeat != now.UnixMilli() || r.NextRetry != 1060000 || d != 15*time.Second {
			t.Fatalf("%+v %v %v", r, e, d)
		}
		beats++
		now = now.Add(d)
		return nil
	})
	if e != nil || beats != 4 || calls != 2 {
		t.Fatalf("%v %d %d", e, beats, calls)
	}
	os.WriteFile(path, []byte("broken"), 0600)
	e = runLoop(context.Background(), config(), path, 1, time.Second, func() error { t.Fatal("polled corrupt checkpoint"); return nil }, time.Now, waitContext)
	r, _ := ReadRuntime(path)
	b, _ := os.ReadFile(path)
	if e == nil || r.State != "failed" || string(b) != "broken" {
		t.Fatalf("%v %+v", e, r)
	}
}
