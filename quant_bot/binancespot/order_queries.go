package binancespot

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strconv"
)

// The console deliberately scopes queries to one symbol to bound request weight.
var symbolPattern = regexp.MustCompile(`^[A-Z0-9]{2,30}$`)

func ValidQuerySymbol(symbol string) bool { return symbolPattern.MatchString(symbol) }

func (c *Client) OpenOrdersContext(ctx context.Context, symbol string) ([]Order, error) {
	return c.queryOrders(ctx, "/api/v3/openOrders", symbol, 0)
}
func (c *Client) AllOrdersContext(ctx context.Context, symbol string, limit int) ([]Order, error) {
	if limit < 1 || limit > 1000 {
		return nil, errors.New("invalid order query limit")
	}
	return c.queryOrders(ctx, "/api/v3/allOrders", symbol, limit)
}
func (c *Client) queryOrders(ctx context.Context, path, symbol string, limit int) ([]Order, error) {
	if !ValidQuerySymbol(symbol) {
		return nil, errors.New("invalid query symbol")
	}
	p := url.Values{"symbol": {symbol}}
	if limit > 0 {
		p.Set("limit", strconv.Itoa(limit))
	}
	raw, err := c.requestContext(ctx, "GET", path, p, true)
	if err != nil {
		return nil, err
	}
	var orders []Order
	if json.Unmarshal(raw, &orders) != nil || orders == nil {
		return nil, errors.New("invalid order list response")
	}
	for _, o := range orders {
		if o.Symbol != symbol || o.OrderID <= 0 || o.ClientOrderID == "" || len(o.ClientOrderID) > 128 || o.Status == "" || len(o.Status) > 40 {
			return nil, errors.New("invalid order identity or status")
		}
		if _, err := nonnegative(o.ExecutedQty); err != nil {
			return nil, errors.New("invalid executed quantity")
		}
	}
	return orders, nil
}
