package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"quant_bot/binancespot"
)

const telegramURL = "https://api.telegram.org/bot"

type user struct {
	ID int64 `json:"id"`
}
type chat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}
type message struct {
	Chat chat   `json:"chat"`
	From user   `json:"from"`
	Text string `json:"text"`
}
type callback struct {
	ID      string  `json:"id"`
	From    user    `json:"from"`
	Message message `json:"message"`
	Data    string  `json:"data"`
}
type update struct {
	UpdateID int64     `json:"update_id"`
	Message  *message  `json:"message"`
	Callback *callback `json:"callback_query"`
}
type keyboardButton struct {
	Text string `json:"text"`
	Data string `json:"callback_data"`
}
type bot struct {
	ctx              context.Context
	lastAction       string
	token            string
	owner            int64
	client           *http.Client
	base             string
	state            string
	paperState       string
	performanceState string
	spot             *binancespot.Client
}

func menu() map[string]any {
	return map[string]any{"inline_keyboard": [][]keyboardButton{
		{{Text: "🏠 總覽", Data: "home"}, {Text: "💰 測試資產", Data: "balance"}},
		{{Text: "📋 訂單紀錄", Data: "orders"}, {Text: "🛡️ 風控狀態", Data: "risk"}},
		{{Text: "🧪 Paper 模擬", Data: "paper"}, {Text: "📈 Paper 績效", Data: "performance"}},
		{{Text: "ℹ️ 使用說明", Data: "help"}, {Text: "🔄 重新整理", Data: "refresh"}},
	}}
}
func authorized(u user, c chat, owner int64) bool {
	return u.ID == owner && c.ID == owner && c.Type == "private"
}

type telegramError struct {
	status     int
	retryAfter time.Duration
}

func (e *telegramError) Error() string {
	return fmt.Sprintf("Telegram API failure (HTTP %d)", e.status)
}
func (b *bot) context() context.Context {
	if b.ctx != nil {
		return b.ctx
	}
	return context.Background()
}
func (b *bot) call(method string, payload any, result any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return errors.New("Telegram request encoding failed")
	}
	req, err := http.NewRequestWithContext(b.context(), http.MethodPost, b.base+method, bytes.NewReader(raw))
	if err != nil {
		return errors.New("Telegram request configuration invalid")
	}
	req.Header.Set("Content-Type", "application/json")
	// Never follow redirects with a token-bearing URL or expose transport errors.
	client := *b.client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := client.Do(req)
	if err != nil {
		return errors.New("Telegram network failure or timeout")
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 512*1024+1))
	if err != nil {
		return errors.New("Telegram response read failed")
	}
	if len(body) > 512*1024 {
		return errors.New("Telegram response too large")
	}
	var wrapper struct {
		OK         bool            `json:"ok"`
		Result     json.RawMessage `json:"result"`
		Parameters struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	decodeErr := json.Unmarshal(body, &wrapper)
	if res.StatusCode != 200 || !wrapper.OK {
		e := &telegramError{status: res.StatusCode}
		seconds := wrapper.Parameters.RetryAfter
		if h, _ := strconv.Atoi(res.Header.Get("Retry-After")); h > seconds {
			seconds = h
		}
		if seconds > 0 {
			if seconds > 86400 {
				seconds = 86400
			}
			e.retryAfter = time.Duration(seconds) * time.Second
		}
		return e
	}
	if decodeErr != nil {
		return errors.New("Telegram response invalid")
	}
	if result != nil {
		if json.Unmarshal(wrapper.Result, result) != nil {
			return errors.New("Telegram result invalid")
		}
	}
	return nil
}
func retryDelay(err error, failures int) time.Duration {
	d := time.Second
	for i := 1; i < failures && d < 30*time.Second; i++ {
		d *= 2
	}
	if d > 30*time.Second {
		d = 30 * time.Second
	}
	var api *telegramError
	if errors.As(err, &api) && api.retryAfter > d {
		d = api.retryAfter
	}
	return d
}
func waitContext(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
func (b *bot) snapshotTime() string {
	info, err := os.Stat(b.state)
	if err != nil {
		return "本機快照：沒有可靠快照／尚未驗證"
	}
	return "本機檔案更新時間 UTC：" + info.ModTime().UTC().Format(time.RFC3339) + "（非即時；不代表逐筆對帳時間）"
}
func (b *bot) send(text string) error {
	return b.call("sendMessage", map[string]any{
		"chat_id": b.owner, "text": text, "reply_markup": menu(),
	}, nil)
}
func (b *bot) view(action string) string {
	return b.viewContent(action) + "\n\n畫面產生時間 UTC：" + time.Now().UTC().Format(time.RFC3339)
}
func (b *bot) viewContent(action string) string {
	if action == "order" || strings.HasPrefix(action, "order ") {
		return b.singleOrder(action)
	}
	if action == "orders" || action == "/orders" || strings.HasPrefix(action, "orders ") || action == "openorders" || strings.HasPrefix(action, "openorders ") {
		if (action == "orders" || action == "/orders") && !b.hasTestnetKeys() {
			return b.viewContent("localorders") + "\n\n⚪ 尚未設定 Testnet 金鑰，無法查詢交易所訂單。"
		}
		return b.exchangeOrders(action)
	}
	switch action {
	case "performance", "/performance":
		return b.performanceView()
	case "paper", "/paper":
		return b.paperView()
	case "home", "/start", "/menu":
		return "🤖 量化交易控制台\n\n🟢 操作模式：唯讀控制台\n🧪 Binance Spot Testnet\n🔒 真實資金交易：關閉\n\n請點下方按鈕查看資訊。\n此介面不能送出訂單或解除風控停機。\n策略執行狀態：尚未驗證（控制台不啟動策略）\n" + b.snapshotTime()
	case "help", "/help":
		return "📖 新手操作\n\n📈 /performance：公開行情 Paper 淨績效（唯讀）\n🧪 Paper 模擬：本機模擬持倉／資金／保存進度，與 Testnet 分開\n💰 測試資產：讀取 Binance Testnet 帳戶餘額\n📋 訂單紀錄：查詢 BTCUSDT 未成交與最近 5 筆測試網訂單\n/orders ETHUSDT：指定交易對\n/openorders BTCUSDT：只查未成交\n/order BTCUSDT <Client ID>：單筆狀態\n/localorders：本機快照（非即時）\n🛡️ 風控狀態：查看停機及當日風險數據\n\n所有按鈕只做查詢，不會買入或賣出。\n查詢失敗時不會猜測餘額或交易狀態。"
	case "risk", "/risk":
		return b.riskView()
	case "localorders", "/localorders":
		s, err := binancespot.LoadState(b.state)
		if err != nil {
			return "⚠️ 訂單資料讀取失敗，請檢查主機檔案；不會清除或重建資料。"
		}
		if len(s.Orders) == 0 {
			return "📋 尚無可靠本機委託快照／尚未驗證。\n這不代表交易所上沒有其他委託。"
		}
		out := "📋 本機 Testnet 訂單狀態（非即時）\n\n"
		count := 0
		ids := make([]string, 0, len(s.Orders))
		for id := range s.Orders {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			status := s.Orders[id]
			if count == 15 {
				out += "\n僅顯示前 15 筆。"
				break
			}
			out += id + "：" + status + "\n"
			count++
		}
		out += "\n⚠️ 如有 PENDING_UNKNOWN，請在命令列人工對帳，勿重送訂單。"
		return out + "\n" + b.snapshotTime() + "\n最後逐筆對帳時間：未記錄。核對：go run ./cmd/binance-spot status --symbol <交易對> --client-order-id <原ID> --state <同一快照檔>"
	case "balance", "/balance":
		if b.spot == nil || b.spot.Key == "" || b.spot.Secret == "" {
			return "⚪ 尚未設定 Binance Spot Testnet 金鑰。\n請在主機環境設定測試網專用憑證。"
		}
		a, err := b.spot.AccountContext(b.context())
		if err != nil {
			return "⚠️ 測試網資產查詢失敗，停止顯示可能過期的數據。\n請檢查網路、Testnet 憑證權限與主機時間後重新整理；本次沒有可靠資產資料。"
		}
		out := "💰 Binance Spot Testnet 資產\n\n"
		n := 0
		for _, bal := range a.Balances {
			if bal.Free == "0" && bal.Locked == "0" {
				continue
			}
			out += fmt.Sprintf("%s：可用 %s / 凍結 %s\n", bal.Asset, bal.Free, bal.Locked)
			n++
			if n == 20 {
				out += "（僅列出前20項）\n"
				break
			}
		}
		if n == 0 {
			out += "未發現非零餘額，或餘額皆為零。\n"
		}
		return out + "\n資料來源：Testnet GET account；查詢完成 UTC：" + time.Now().UTC().Format(time.RFC3339) + "\n🧪 僅測試資金；不是實盤資產。"
	default:
		return "❓ 不認識這個操作。請使用下方按鈕。"
	}
}
func haltReason(reason string) string {
	switch reason {
	case "daily loss limit":
		return "當日虧損達上限"
	case "max drawdown":
		return "最大回撤達上限"
	case "API preflight failure: manual reconciliation required":
		return "API 前置查詢失敗，需要人工對帳"
	default:
		return "本地風控鎖定，請在主機檢查原因"
	}
}
func normalize(text string) string {
	cmd := strings.Fields(text)
	if len(cmd) == 0 {
		return "home"
	}
	first := strings.SplitN(cmd[0], "@", 2)[0]
	switch first {
	case "/start", "/menu":
		return "home"
	case "/performance":
		return "performance"
	case "/paper":
		return "paper"
	case "/balance":
		return "balance"
	case "/order":
		if len(cmd) != 3 {
			return "order"
		}
		return "order " + strings.ToUpper(cmd[1]) + " " + cmd[2]
	case "/orders", "/openorders":
		action := strings.TrimPrefix(first, "/")
		if len(cmd) > 2 {
			return action + " invalid arguments"
		}
		if len(cmd) == 2 {
			return action + " " + strings.ToUpper(cmd[1])
		}
		return action
	case "/localorders":
		return "localorders"
	case "/risk":
		return "risk"
	case "/help":
		return "help"
	default:
		return first
	}
}
func (b *bot) handle(u update) error {
	var action string
	var from user
	var room chat
	if u.Callback != nil {
		from = u.Callback.From
		room = u.Callback.Message.Chat
		action = u.Callback.Data
		// Authenticate before acknowledging or querying protected data.
		if !authorized(from, room, b.owner) {
			return nil
		}
		if err := b.call("answerCallbackQuery", map[string]any{"callback_query_id": u.Callback.ID}, nil); err != nil {
			return err
		}
	} else if u.Message != nil {
		from = u.Message.From
		room = u.Message.Chat
		action = normalize(u.Message.Text)
	} else {
		return nil
	}
	if !authorized(from, room, b.owner) {
		return nil
	}
	if action == "refresh" {
		action = b.lastAction
		if action == "" {
			action = "home"
		}
	}
	b.lastAction = action
	return b.send(b.view(action))
}
func (b *bot) poll() error {
	offset := int64(0)
	failures := 0
	for b.context().Err() == nil {
		var updates []update
		err := b.call("getUpdates", map[string]any{"offset": offset, "timeout": 20, "allowed_updates": []string{"message", "callback_query"}}, &updates)
		if err == nil {
			for _, u := range updates {
				if b.context().Err() != nil {
					break
				}
				if u.UpdateID < offset {
					continue
				}
				offset = u.UpdateID + 1
				if err = b.handle(u); err != nil {
					break
				}
			}
		}
		if err != nil {
			failures++
			delay := retryDelay(err, failures)
			log.Printf("Telegram request failed: %v; consecutive=%d; backoff=%s", err, failures, delay)
			if !waitContext(b.context(), delay) {
				break
			}
		} else {
			failures = 0
		}
	}
	return nil
}
func main() {
	pairing := len(os.Args) == 2 && os.Args[1] == "--pair"
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	owner, err := strconv.ParseInt(os.Getenv("TELEGRAM_OWNER_ID"), 10, 64)
	if token == "" || (!pairing && (err != nil || owner <= 0)) {
		log.Fatal("set TELEGRAM_BOT_TOKEN and numeric TELEGRAM_OWNER_ID; no secrets in source code")
	}
	if strings.ContainsAny(token, " /") {
		log.Fatal("invalid token format")
	}

	b := &bot{token: token, owner: owner, client: &http.Client{Timeout: 35 * time.Second}, base: telegramURL + token + "/", state: "state-testnet.json", paperState: ".local/session.paper.json",
		spot: binancespot.NewClient(os.Getenv("BINANCE_TESTNET_API_KEY"), os.Getenv("BINANCE_TESTNET_API_SECRET"))}
	b.performanceState = os.Getenv("PERFORMANCE_STATE")
	if paper := os.Getenv("PAPER_STATE"); paper != "" {
		b.paperState = paper
	}
	if state := os.Getenv("BINANCE_TESTNET_STATE"); state != "" {
		b.state = state
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	defer stop()
	b.ctx = ctx
	if pairing {
		err := binancespot.WithLock(b.state+".telegram", func() error {
			id, err := b.pairOwner(os.Stdin, os.Stderr)
			if err == nil {
				fmt.Println(id)
			}
			return err
		})
		if err != nil {
			log.Fatal(err)
		}
		return
	}
	if err := binancespot.WithLock(b.state+".telegram", func() error {
		log.Println("read-only Telegram dashboard started; Spot Testnet only")
		return b.poll()
	}); err != nil {
		log.Fatal("Telegram instance lock unavailable; inspect existing process and lock before restarting")
	}
	log.Println("Telegram dashboard stopped")
}
