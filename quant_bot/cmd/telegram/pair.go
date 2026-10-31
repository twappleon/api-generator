package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"
)

func pairingCandidate(u update, challenge string) (int64, bool) {
	if u.Message == nil {
		return 0, false
	}
	m := u.Message
	return m.From.ID, m.Text == "/pair "+challenge && m.From.ID > 0 && m.Chat.Type == "private" && m.Chat.ID == m.From.ID
}

// A terminal read must not keep the lock held after cancellation or SIGHUP.
func confirmPairing(ctx context.Context, input io.Reader) error {
	result := make(chan bool, 1)
	go func() {
		var answer string
		_, err := fmt.Fscanln(input, &answer)
		result <- err == nil && answer == "yes"
	}()
	select {
	case <-ctx.Done():
		return errors.New("配對已逾時或取消；請重新啟動")
	case confirmed := <-result:
		if !confirmed {
			return errors.New("未確認配對；未設定 owner")
		}
		if ctx.Err() != nil {
			return errors.New("配對已逾時或取消；請重新啟動")
		}
		return nil
	}
}

// Pairing only reads Telegram updates. The numeric owner is returned to the
// launcher's environment after challenge possession and local confirmation.
func (b *bot) pairOwner(input io.Reader, output io.Writer) (int64, error) {
	ctx, cancel := context.WithTimeout(b.context(), 5*time.Minute)
	defer cancel()
	pairing := *b
	pairing.ctx = ctx
	var me struct {
		Username string `json:"username"`
		IsBot    bool   `json:"is_bot"`
	}
	if err := pairing.call("getMe", nil, &me); err != nil {
		return 0, err
	}
	if !me.IsBot || me.Username == "" {
		return 0, errors.New("無法確認 Bot 身分")
	}
	var webhook struct {
		URL string `json:"url"`
	}
	if err := pairing.call("getWebhookInfo", nil, &webhook); err != nil {
		return 0, err
	}
	if webhook.URL != "" {
		return 0, errors.New("此 Bot 已有 webhook；請先確認既有服務，不會自動移除")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return 0, errors.New("無法建立安全配對碼")
	}
	challenge := hex.EncodeToString(nonce[:])
	fmt.Fprintf(output, "\n已驗證 Bot：@%s\n請在 Telegram 私聊這個 Bot，傳送以下整行（五分鐘內有效）：\n/pair %s\n", me.Username, challenge)
	offset := int64(0)
	for ctx.Err() == nil {
		var updates []update
		if err := pairing.call("getUpdates", map[string]any{"offset": offset, "timeout": 20, "allowed_updates": []string{"message", "callback_query"}}, &updates); err != nil {
			return 0, err
		}
		for _, u := range updates {
			if u.UpdateID < offset {
				continue
			}
			offset = u.UpdateID + 1
			if id, ok := pairingCandidate(u, challenge); ok {
				fmt.Fprintf(output, "收到配對碼，Telegram user ID：%d。若剛才是你本人傳送，請在此終端輸入 yes 確認：", id)
				if err := confirmPairing(ctx, input); err != nil {
					return 0, err
				}
				fmt.Fprintln(output, "配對完成；owner ID 僅傳入本機環境變數。")
				return id, nil
			}
		}
	}
	return 0, errors.New("配對逾時或已取消")
}
