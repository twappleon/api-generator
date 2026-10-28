package main

import (
 "os"
 "path/filepath"
 "strings"
 "testing"

 "quant_bot/binancespot"
)
func TestAuthorizedPrivateOwnerOnly(t *testing.T){
 owner:=int64(1234)
 cases:=[]struct{u user;c chat;ok bool}{
  {user{1234},chat{1234,"private"},true},
  {user{9999},chat{1234,"private"},false},
  {user{1234},chat{-100,"supergroup"},false},
  {user{1234},chat{9999,"private"},false},
 }
 for _,v:=range cases{if authorized(v.u,v.c,owner)!=v.ok{t.Fatalf("wrong auth %+v",v)}}
}
func TestNormalizeAndMenu(t *testing.T){
 for raw,want:=range map[string]string{"/start":"home","/balance@MyBot":"balance","/orders":"orders","/risk":"risk","/help":"help","":"home"}{
  if got:=normalize(raw);got!=want{t.Errorf("normalize %q=%q want %q",raw,got,want)}
 }
 m:=menu()
 if m["inline_keyboard"]==nil{t.Fatal("missing buttons")}
}
func TestRiskMessagesAndReadOnly(t *testing.T){
 b:=bot{state:filepath.Join(t.TempDir(),"state-testnet.json")}
 home:=b.view("home")
 if !strings.Contains(home,"唯讀")||!strings.Contains(home,"關閉"){t.Fatal("unsafe dashboard")}
 if !strings.Contains(b.view("risk"),"尚無可靠"){t.Fatal("missing state falsely reported as safe")}
 if err:=binancespot.SaveState(b.state,binancespot.State{Day:"2026-10-28",DayStart:1000,Peak:1000,Kill:true,KillReason:"daily loss"});err!=nil{t.Fatal(err)}
 if !strings.Contains(b.view("risk"),"已停機"){t.Fatal("halt not visible")}
 if !strings.Contains(b.view("orders"),"尚無"){t.Fatal("missing order message")}
}
func TestInvalidStateFailClosed(t *testing.T){
 p:=filepath.Join(t.TempDir(),"state.json")
 if err:=os.WriteFile(p,[]byte("{broken"),0600);err!=nil{t.Fatal(err)}
 b:=bot{state:p}
 if !strings.Contains(b.view("risk"),"失敗"){t.Fatal("corrupt state not detected")}
}
