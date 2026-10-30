package research

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const marketHost = "https://data-api.binance.vision"

type Market struct{ Client *http.Client }

func (m Market) get(ctx context.Context, path string, q url.Values, out any) error {
	if path != "/api/v3/klines" && path != "/api/v3/time" {
		return errors.New("public market path only")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, marketHost+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	client := http.Client{Timeout: 15 * time.Second}
	if m.Client != nil {
		client = *m.Client
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("market redirect blocked") }
	res, err := client.Do(req)
	if err != nil {
		return errors.New("public market transport failed")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("public market HTTP %d; stopped", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 2*1024*1024+1))
	if err != nil {
		return err
	}
	if len(raw) > 2*1024*1024 {
		return errors.New("market response too large")
	}
	return json.Unmarshal(raw, out)
}
func (m Market) Now(ctx context.Context) (int64, error) {
	var v struct {
		ServerTime int64 `json:"serverTime"`
	}
	err := m.get(ctx, "/api/v3/time", nil, &v)
	if err == nil && v.ServerTime <= 0 {
		err = errors.New("invalid server time")
	}
	return v.ServerTime, err
}

// History returns every closed candle in [start,end), with bounded pagination and no gap filling.
func (m Market) History(ctx context.Context, c Config, start, end, now int64) ([]Candle, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	d := Duration(c.Interval)
	if start <= 0 || end <= start || start%d != 0 || end%d != 0 || (end-start)/d > 100000 || end > now {
		return nil, errors.New("invalid range; require closed aligned range <=100000 candles")
	}
	var out []Candle
	for cursor := start; cursor < end; {
		q := url.Values{"symbol": {c.Symbol}, "interval": {c.Interval}, "startTime": {strconv.FormatInt(cursor, 10)}, "endTime": {strconv.FormatInt(end-1, 10)}, "limit": {"1000"}}
		var rows [][]json.RawMessage
		if err := m.get(ctx, "/api/v3/klines", q, &rows); err != nil {
			return nil, err
		}
		if len(rows) == 0 || len(rows) > 1000 {
			return nil, errors.New("missing/oversized candle page")
		}
		for _, r := range rows {
			if len(r) < 7 {
				return nil, errors.New("short candle row")
			}
			var b Candle
			if json.Unmarshal(r[0], &b.Time) != nil || json.Unmarshal(r[6], &b.End) != nil {
				return nil, errors.New("invalid candle timestamps")
			}
			prices := []*float64{&b.Open, &b.High, &b.Low, &b.Close}
			for i, p := range prices {
				var value string
				if json.Unmarshal(r[i+1], &value) != nil {
					return nil, errors.New("invalid price string")
				}
				v, err := strconv.ParseFloat(value, 64)
				if err != nil {
					return nil, err
				}
				*p = v
			}
			if err := b.Validate(d); err != nil {
				return nil, err
			}
			if b.Time != cursor || b.End >= now || b.Time >= end {
				return nil, errors.New("unordered/gapped/unclosed candle")
			}
			out = append(out, b)
			cursor += d
		}
	}
	return out, nil
}
