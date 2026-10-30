package research

import (
	"context"
	"errors"
	"os"
	"quant_bot/paperstate"
	"strings"
	"time"
)

func Backtest(ctx context.Context, m Market, c Config, start, end int64) (State, error) {
	s, err := New(c, "historical")
	if err != nil {
		return s, err
	}
	if start >= end {
		return s, errors.New("start must precede end")
	}
	now, err := m.Now(ctx)
	if err != nil {
		return s, err
	}
	d := Duration(c.Interval)
	bars, err := m.History(ctx, c, start-int64(c.LongWindow+1)*d, end, now)
	if err != nil {
		return s, err
	}
	warm := c.LongWindow + 1
	if err = s.Seed(bars[:warm]); err != nil {
		return s, err
	}
	for _, b := range bars[warm:] {
		if _, err = s.Apply(b); err != nil {
			return s, err
		}
	}
	s.Updated = now
	return s, nil
}

// Poll resumes sequential closed bars; initial bootstrap only warms the strategy.
func Poll(ctx context.Context, m Market, c Config, path string) error {
	s, err := Read(path)
	if os.IsNotExist(err) {
		s, err = New(c, "live-paper")
	}
	if err != nil {
		return err
	}
	if s.Config != c || s.Source != "live-paper" {
		return errors.New("snapshot configuration/source mismatch")
	}
	now, err := m.Now(ctx)
	if err != nil {
		return err
	}
	d := Duration(c.Interval)
	end := now / d * d
	start := s.Last + d
	if s.Last == 0 {
		start = end - int64(c.LongWindow+1)*d
	}
	if start >= end {
		return nil
	}
	bars, err := m.History(ctx, c, start, end, now)
	if err != nil {
		return err
	}
	if s.Last == 0 {
		if err = s.Seed(bars); err != nil {
			return err
		}
		s.Updated = now
		return Save(path, s)
	}
	for _, b := range bars {
		if _, err = s.Apply(b); err != nil {
			return err
		}
		s.Updated = now
		if err = Save(path, s); err != nil {
			return err
		}
	}
	return nil
}
func Run(ctx context.Context, m Market, c Config, path string, polls int, interval time.Duration) error {
	if !strings.HasSuffix(path, ".performance.paper.json") {
		return errors.New("isolated performance path required")
	}
	if err := c.Validate(); err != nil {
		return err
	}
	if polls < 0 || interval < time.Second {
		return errors.New("polls must be >=0; interval >=1s")
	}
	return paperstate.WithLock(path, func() error {
		for i := 0; polls == 0 || i < polls; i++ {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := Poll(ctx, m, c, path); err != nil {
				return err
			}
			if polls > 0 && i+1 == polls {
				break
			}
			timer := time.NewTimer(interval)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		return nil
	})
}
