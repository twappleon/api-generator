package main

import (
 "bytes"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "log"
 "net/http"
 "os"
 "strconv"
 "strings"
 "time"

 "quant_bot/binancespot"
)

const telegramURL="https://api.telegram.org/bot"
type user struct {ID int64 `json:"id"`}
type chat struct {ID int64 `json:"id"`; Type string `json:"type"`}
type message struct {Chat chat `json:"chat"`; From user `json:"from"`; Text string `json:"text"`}
type callback struct {ID string `json:"id"`;From user `json:"from"`; Message message `json:"message"`;Data string `json:"data"`}
type update struct {UpdateID int64 `json:"update_id"`;Message *message `json:"message"`;Callback *callback `json:"callback_query"`}
type keyboardButton struct {Text string `json:"text"`;Data string `json:"callback_data"`}
type bot struct {
 token string
 owner int64
 client *http.Client
 base string
 state string
 spot *binancespot.Client
}
func menu() map[string]any {
 return map[string]any{"inline_keyboard":[][]keyboardButton{
  {{Text:"🏠 總覽",Data:"home"},{Text:"💰 測試資產",Data:"balance"}},
  {{Text:"📋 訂單紀錄",Data:"orders"},{Text:"🛡️ 風控狀態",Data:"risk"}},
  {{Text:"ℹ️ 使用說明",Data:"help"},{Text:"🔄 重新整理",Data:"home"}},
 }}
}
func authorized(u user,c chat,owner int64)bool{return u.ID==owner && c.ID==owner && c.Type=="private"}
func (b *bot) call(method string,payload any,result any)error {
 raw,err:=json.Marshal(payload);if err!=nil{return err}
 req,err:=http.NewRequest(http.MethodPost,b.base+method,bytes.NewReader(raw));if err!=nil{return err}
 req.Header.Set("Content-Type","application/json")
 res,err:=b.client.Do(req);if err!=nil{return err};defer res.Body.Close()
 body,err:=io.ReadAll(io.LimitReader(res.Body,512*1024));if err!=nil{return err}
 var wrapper struct{OK bool `json:"ok"`;Description string `json:"description"`; Result json.RawMessage `json:"result"`}
 if err=json.Unmarshal(body,&wrapper);err!=nil{return err}
 if res.StatusCode!=200||!wrapper.OK{return fmt.Errorf("telegram HTTP %d: %s",res.StatusCode,wrapper.Description)}
 if result!=nil{return json.Unmarshal(wrapper.Result,result)}
 return nil
}
func (b *bot) send(text string) error {
 return b.call("sendMessage",map[string]any{
  "chat_id":b.owner,"text":text,"reply_markup":menu(),
 },nil)
}
func (b *bot) view(action string)string{
 switch action {
 case "home","/start","/menu":
  return "🤖 量化交易控制台\n\n🟢 操作模式：唯讀控制台\n🧪 Binance Spot Testnet\n🔒 真實資金交易：關閉\n\n請點下方按鈕查看資訊。\n此介面不能送出訂單或解除風控停機。"
 case "help","/help":
  return "📖 新手操作\n\n💰 測試資產：讀取 Binance Testnet 帳戶餘額\n📋 訂單紀錄：查看本機已追蹤委託\n🛡️ 風控狀態：查看停機及當日風險數據\n\n所有按鈕只做查詢，不會買入或賣出。\n查詢失敗時不會猜測餘額或交易狀態。"
 case "risk","/risk":
  s,err:=binancespot.LoadState(b.state)
  if err!=nil{return "⚠️ 風控資料讀取失敗，請檢查主機狀態。\n"+err.Error()}
  if s.Day=="" {return "⚪ 尚無可靠風控快照。\n尚未執行 Testnet 訂單前置檢查，不能代表交易安全。"}
  state:="✅ 未觸發本地停機"
  if s.Kill{state="🛑 已停機："+s.KillReason}
  return fmt.Sprintf("🛡️ 風控狀態\n%s\n\n風控日期 UTC：%s\n當日基準：%.2f USDT\n記錄峰值：%.2f USDT\n\n注意：數據為最近一次記錄，非即時帳戶淨值。",state,s.Day,s.DayStart,s.Peak)
 case "orders","/orders":
  s,err:=binancespot.LoadState(b.state)
  if err!=nil{return "⚠️ 訂單資料讀取失敗："+err.Error()}
  if len(s.Orders)==0 {return "📋 尚無本機委託紀錄。\n這不代表交易所上沒有其他委託。"}
  out:="📋 本機 Testnet 訂單狀態（非即時）\n\n"
  count:=0
  for id,status:=range s.Orders {
   if count==15 {out+="\n僅顯示前 15 筆。";break}
   out+=id+"："+status+"\n";count++
  }
  out+="\n⚠️ 如有 PENDING_UNKNOWN，請在命令列人工對帳，勿重送訂單。"
  return out
 case "balance","/balance":
  if b.spot.Key==""||b.spot.Secret=="" {return "⚪ 尚未設定 Binance Spot Testnet 金鑰。\n請在主機環境設定測試網專用憑證。"}
  a,err:=b.spot.Account()
  if err!=nil{return "⚠️ 測試網資產查詢失敗，停止顯示可能過期的數據。\n請在主機查閱錯誤紀錄。"}
  out:="💰 Binance Spot Testnet 資產\n\n"
  n:=0
  for _,bal:=range a.Balances {
   if bal.Free=="0"&&bal.Locked=="0"{continue}
   out+=fmt.Sprintf("%s：可用 %s / 凍結 %s\n",bal.Asset,bal.Free,bal.Locked)
   n++
   if n==20 {out+="（僅列出前20項）\n";break}
  }
  if n==0{out+="未發現非零餘額，或餘額皆為零。\n"}
  return out+"\n🧪 僅測試資金；不是實盤資產。"
 default:return "❓ 不認識這個操作。請使用下方按鈕。"
 }
}
func normalize(text string)string{
 cmd:=strings.Fields(text)
 if len(cmd)==0{return "home"}
 first:=strings.SplitN(cmd[0],"@",2)[0]
 switch first {
 case "/start","/menu":return "home"
 case "/balance":return "balance"
 case "/orders":return "orders"
 case "/risk":return "risk"
 case "/help":return "help"
 default:return first
 }
}
func (b *bot) handle(u update) {
 var action string
 var from user
 var room chat
 if u.Callback!=nil {
  from=u.Callback.From;room=u.Callback.Message.Chat;action=u.Callback.Data
  // Every callback must be acknowledged. Do not leak protected information to strangers.
  _=b.call("answerCallbackQuery",map[string]any{"callback_query_id":u.Callback.ID},nil)
 }else if u.Message!=nil {
  from=u.Message.From;room=u.Message.Chat;action=normalize(u.Message.Text)
 }else{return}
 if !authorized(from,room,b.owner){return}
 if err:=b.send(b.view(action));err!=nil{log.Printf("telegram send error: %v",err)}
}
func (b *bot) poll()error{
 offset:=int64(0)
 for {
  var updates []update
  err:=b.call("getUpdates",map[string]any{"offset":offset,"timeout":20,"allowed_updates":[]string{"message","callback_query"}},&updates)
  if err!=nil {log.Printf("telegram polling error: %v",err);time.Sleep(5*time.Second);continue}
  for _,u:=range updates {
   if u.UpdateID>=offset{offset=u.UpdateID+1}
   b.handle(u)
  }
 }
}
func main(){
 token:=os.Getenv("TELEGRAM_BOT_TOKEN")
 owner,err:=strconv.ParseInt(os.Getenv("TELEGRAM_OWNER_ID"),10,64)
 if err!=nil||owner<=0||token==""{log.Fatal("set TELEGRAM_BOT_TOKEN and numeric TELEGRAM_OWNER_ID; no secrets in source code")}
 if strings.ContainsAny(token," /"){log.Fatal("invalid token format")}

 b:=&bot{token:token,owner:owner,client:&http.Client{Timeout:35*time.Second},base:telegramURL+token+"/",state:"state-testnet.json",
 spot:binancespot.NewClient(os.Getenv("BINANCE_TESTNET_API_KEY"),os.Getenv("BINANCE_TESTNET_API_SECRET"))}
 if state:=os.Getenv("BINANCE_TESTNET_STATE");state!=""{b.state=state}
 log.Println("read-only Telegram dashboard started; Spot Testnet only")
 log.Fatal(b.poll())
}
