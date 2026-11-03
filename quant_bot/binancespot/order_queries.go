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
		if err := validateQueriedOrder(o, symbol); err != nil {
			return nil, err
		}
	}
	return orders, nil
}

// Read-only lookup: does not reconcile or write the local risk ledger.
func (c *Client) OrderStatusContext(ctx context.Context, symbol, id string) (result Order, queryErr error) {
	defer func() {
		if queryErr != nil {
			c.failed = true
		}
	}()
	if !ValidQuerySymbol(symbol) || !clientIDPattern.MatchString(id) {
		return Order{}, errors.New("invalid order query identity")
	}
	raw, err := c.requestContext(ctx, "GET", "/api/v3/order", url.Values{"symbol": {symbol}, "origClientOrderId": {id}}, true)
	if err != nil {
		return Order{}, err
	}
	var o Order
	if json.Unmarshal(raw, &o) != nil {
		return Order{}, errors.New("invalid order response")
	}
	if err := validateQueriedOrder(o, symbol); err != nil {
		return Order{}, err
	}
	if o.ClientOrderID != id {
		return Order{}, errors.New("order identity mismatch")
	}
	return o, nil
}
func validateQueriedOrder(o Order, symbol string) error {
	if o.Symbol != symbol || o.OrderID <= 0 || !clientIDPattern.MatchString(o.ClientOrderID) || o.Status == "" || len(o.Status) > 40 {
		return errors.New("invalid order identity or status")
	}
	if len(o.ExecutedQty) > 40 {
		return errors.New("invalid executed quantity")
	}
	if _, err := nonnegative(o.ExecutedQty); err != nil {
		return errors.New("invalid executed quantity")
	}
	if o.OriginalQty != "" {
		if len(o.OriginalQty) > 40 {
			return errors.New("invalid original quantity")
		}
		if _, err := nonnegative(o.OriginalQty); err != nil {
			return errors.New("invalid original quantity")
		}
	}
	if o.UpdateTime < 0 {
		return errors.New("invalid order update time")
	}
	return nil
}
