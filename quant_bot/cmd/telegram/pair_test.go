package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestPairingCandidate(t *testing.T) {
	u := ownerMessage(1)
	u.Message.Text = "/pair challenge"
	if id, ok := pairingCandidate(u, "challenge"); !ok || id != 1234 {
		t.Fatal("valid private owner rejected")
	}
	for _, mutate := range []func(*update){
		func(u *update) { u.Message.Text = "/pair wrong" },
		func(u *update) { u.Message.Chat.Type = "group" },
		func(u *update) { u.Message.Chat.ID = 999 },
		func(u *update) { u.Message.From.ID = 0 },
		func(u *update) { u.Message = nil },
	} {
		u := ownerMessage(1)
		u.Message.Text = "/pair challenge"
		mutate(&u)
		if _, ok := pairingCandidate(u, "challenge"); ok {
			t.Fatal("invalid pair accepted")
		}
	}
}

type pairingOutput struct {
	bytes.Buffer
	challenge chan string
}

func (o *pairingOutput) Write(p []byte) (int, error) {
	if i := strings.Index(string(p), "/pair "); i >= 0 {
		o.challenge <- strings.Fields(string(p)[i:])[1]
	}
	return o.Buffer.Write(p)
}
func TestPairingRequiresLocalConfirmation(t *testing.T) {
	for _, answer := range []string{"yes\n", "no\n"} {
		t.Run(strings.TrimSpace(answer), func(t *testing.T) {
			out := &pairingOutput{challenge: make(chan string, 1)}
			b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
				switch {
				case strings.HasSuffix(r.URL.Path, "getMe"):
					fmt.Fprint(w, `{"ok":true,"result":{"is_bot":true,"username":"local_test_bot"}}`)
				case strings.HasSuffix(r.URL.Path, "getWebhookInfo"):
					fmt.Fprint(w, `{"ok":true,"result":{"url":""}}`)
				case strings.HasSuffix(r.URL.Path, "getUpdates"):
					code := <-out.challenge
					if len(code) != 32 {
						t.Error("weak challenge")
					}
					u := ownerMessage(1)
					u.Message.Text = "/pair " + code
					_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": []update{u}})
				default:
					t.Error("unexpected pairing mutation")
					w.WriteHeader(500)
				}
			})
			id, err := b.pairOwner(strings.NewReader(answer), out)
			if answer == "yes\n" {
				if err != nil || id != 1234 {
					t.Fatalf("pairing failed: %v", err)
				}
			} else if err == nil || id != 0 {
				t.Fatal("paired without local confirmation")
			}
		})
	}
}
func TestPairingPreservesExistingWebhook(t *testing.T) {
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "getMe") {
			fmt.Fprint(w, `{"ok":true,"result":{"is_bot":true,"username":"local_test_bot"}}`)
			return
		}
		if !strings.HasSuffix(r.URL.Path, "getWebhookInfo") {
			t.Error("webhook modified or polling started")
		}
		fmt.Fprint(w, `{"ok":true,"result":{"url":"https://existing.invalid"}}`)
	})
	var out bytes.Buffer
	if _, err := b.pairOwner(strings.NewReader("yes\n"), &out); err == nil {
		t.Fatal("existing webhook ignored")
	}
}

func TestPairingConfirmationCancellation(t *testing.T) {
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- confirmPairing(ctx, reader) }()
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled confirmation accepted")
		}
	case <-time.After(time.Second):
		t.Fatal("terminal read blocked cancellation")
	}
}
func TestPairingConfirmationEOF(t *testing.T) {
	if confirmPairing(context.Background(), strings.NewReader("")) == nil {
		t.Fatal("closed terminal accepted")
	}
}
