package main

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"quant_bot/binancespot"
)

func (b *bot) hasTestnetKeys() bool { return b.spot != nil && b.spot.Key != "" && b.spot.Secret != "" }
func orderQueryError(err error) string {
	var api *binancespot.APIError
	if errors.As(err, &api) {
		switch {
		case api.Status == 429 || api.Status == 418:
			return "請求受限，請稍後再查詢；不要連續重新整理。"
		case api.Code == -1021:
			return "主機時間偏差，請校正時間後再查詢。"
		case api.Code == -1121:
			return "交易對無效，請確認 Testnet 支援此交易對。"
		case api.Status == 401 || api.Status == 403 || api.Code == -2014 || api.Code == -2015:
			return "憑證或 USER_DATA 權限無效，請在本機確認。"
		case api.Status >= 500:
			return "Testnet 服務暫時異常，請稍後再查詢。"
		}
	}
	return "網路逾時或回應格式異常，請檢查連線後再查詢。"
}
func orderRows(orders []binancespot.Order) string {
	sort.Slice(orders, func(i, j int) bool { return orders[i].OrderID > orders[j].OrderID })
	out := ""
	for i, o := range orders {
		if i == 5 {
			break
		}
		out += fmt.Sprintf("訂單 %d｜%s\nClient ID：%s\n已成交數量：%s\n", o.OrderID, o.Status, o.ClientOrderID, o.ExecutedQty)
	}
	return out
}
func (b *bot) exchangeOrders(action string) string {
	fields := strings.Fields(action)
	symbol := "BTCUSDT"
	if len(fields) == 2 {
		symbol = fields[1]
	}
	if len(fields) > 2 || !binancespot.ValidQuerySymbol(symbol) {
		return "⚠️ 請使用 /orders BTCUSDT 或 /openorders BTCUSDT；每次查詢一個交易對。"
	}
	if !b.hasTestnetKeys() {
		return "⚪ 尚未設定 Binance Spot Testnet 金鑰，無法查詢交易所訂單。"
	}
	out := "📋 Binance Spot Testnet 訂單（唯讀）\n交易對：" + symbol + "（僅此交易對，非全帳戶）\n\n"
	open, err := b.spot.OpenOrdersContext(b.context(), symbol)
	if err != nil {
		return out + "⚠️ 未成交訂單查詢失敗：" + orderQueryError(err) + "\n本次沒有可靠訂單資料，不顯示舊結果。"
	}
	out += fmt.Sprintf("未成交訂單：%d 筆（最多顯示 5 筆）\n", len(open)) + orderRows(open)
	out += "來源：Testnet GET openOrders\n查詢完成 UTC：" + time.Now().UTC().Format(time.RFC3339) + "\n"
	if fields[0] != "openorders" {
		history, err := b.spot.AllOrdersContext(b.context(), symbol, 5)
		if err != nil {
			return out + "\n⚠️ 訂單紀錄查詢失敗：" + orderQueryError(err) + "\n紀錄未知，不代表沒有歷史訂單。"
		}
		out += "\n最近訂單紀錄（最多 5 筆，含未成交／已結束）：\n"
		if len(history) == 0 {
			out += "本次查詢未返回訂單紀錄。\n"
		} else {
			out += orderRows(history)
		}
		out += "來源：Testnet GET allOrders\n查詢完成 UTC：" + time.Now().UTC().Format(time.RFC3339) + "\n"
	}
	return out + "\nTestnet 可能重設資料；非完整歷史，非本機對帳。\n/orders ETHUSDT 可指定交易對；/localorders 看本機快照。\n僅查詢，沒有建立、取消或修改訂單。"
}
