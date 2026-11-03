// Package paperstate stores simulation-only state, never Testnet risk state.
package paperstate

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Position struct {
	EntryPrice float64
	Qty        float64
	StopLoss   float64
	TakeProfit float64
	EntryTime  int64
	EntryFee   float64
}
type State struct {
	Kind       string    `json:"kind"`
	Version    int       `json:"version"`
	Config     string    `json:"config"`
	Cash       float64   `json:"cash"`
	Position   *Position `json:"position"`
	Step       int       `json:"step"`
	LastCandle int64     `json:"last_candle"`
}

func validNumber(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 }
func validate(s State) error {
	if s.Kind != "paper" || s.Version != 1 || s.Config == "" || !validNumber(s.Cash) || s.Step < 0 || s.Step > 1000000 || s.LastCandle < 0 {
		return errors.New("invalid Paper snapshot; refusing reset")
	}
	if (s.Step == 0) != (s.LastCandle == 0) {
		return errors.New("inconsistent Paper progress")
	}
	if p := s.Position; p != nil {
		if !validNumber(p.EntryPrice) || p.EntryPrice == 0 || !validNumber(p.Qty) || p.Qty == 0 || !validNumber(p.StopLoss) || p.StopLoss == 0 || !validNumber(p.TakeProfit) || p.TakeProfit <= p.StopLoss || !validNumber(p.EntryFee) || p.EntryTime <= 0 || p.EntryTime > s.LastCandle {
			return errors.New("invalid Paper position; refusing reset")
		}
	}
	return nil
}
func Load(path, config string, initial float64) (State, error) {
	s := State{Kind: "paper", Version: 1, Config: config, Cash: initial}
	disk, _, err := ReadSnapshot(path)
	if os.IsNotExist(err) {
		return s, validate(s)
	}
	if err != nil {
		return State{}, err
	}
	if disk.Config != config {
		return State{}, errors.New("Paper configuration/source differs; use a separate snapshot")
	}
	return disk, nil
}

// ReadSnapshot never initializes a missing file or modifies the simulation.
// Read and stat the same descriptor so an atomic writer cannot mix generations.
func ReadSnapshot(path string) (State, time.Time, error) {
	f, err := os.Open(path)
	if err != nil {
		return State{}, time.Time{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return State{}, time.Time{}, err
	}
	raw, err := io.ReadAll(io.LimitReader(f, 65537))
	if err != nil {
		return State{}, time.Time{}, err
	}
	if len(raw) > 65536 {
		return State{}, time.Time{}, errors.New("Paper snapshot too large")
	}
	disk, err := decode(raw)
	return disk, info.ModTime(), err
}
func decode(raw []byte) (State, error) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return State{}, errors.New("corrupt Paper snapshot; refusing reset")
	}
	for _, key := range []string{"kind", "version", "config", "cash", "position", "step", "last_candle"} {
		if value, ok := fields[key]; !ok || (key != "position" && strings.TrimSpace(string(value)) == "null") {
			return State{}, errors.New("incomplete Paper snapshot; refusing reset")
		}
	}
	var disk State
	if json.Unmarshal(raw, &disk) != nil || validate(disk) != nil {
		return State{}, errors.New("invalid Paper snapshot; refusing reset")
	}
	return disk, nil
}
func Save(path string, s State) error {
	if err := validate(s); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return WriteAtomic(path, raw)
}

// WriteAtomic commits already validated bytes using the existing checkpoint protocol.
func WriteAtomic(path string, raw []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".paper-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	if _, err = f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
func WithLock(path string, fn func() error) (result error) {
	if !strings.HasSuffix(path, ".paper.json") {
		return errors.New("Paper snapshot must end in .paper.json; Testnet state is forbidden")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if other := os.Getenv("BINANCE_TESTNET_STATE"); other != "" {
		target, _ := filepath.Abs(other)
		if target == abs {
			return errors.New("Paper and Testnet paths must differ")
		}
	}
	if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Paper snapshot symlink forbidden")
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return errors.New("Paper instance lock unavailable; inspect existing process before recovery")
	}
	defer func() {
		if err := os.Remove(path + ".lock"); err != nil {
			result = errors.Join(result, fmt.Errorf("Paper lock cleanup failed; inspect before restart: %w", err))
		}
	}()
	if _, err := fmt.Fprintln(f, os.Getpid()); err != nil {
		f.Close()
		return fmt.Errorf("Paper lock owner write failed: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("Paper lock close failed: %w", err)
	}
	return fn()
}
