import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { timingSafeEqual, randomBytes } from "node:crypto";

// K Signal Paper Lab — research-only, no exchange account or order placement.
const password = Bun.env.APP_PASSWORD || "";
if (password.length < 16) throw new Error("APP_PASSWORD must be >= 16 characters");
const path = Bun.env.DATA_FILE || "/app/data/state.json";
const source = "https://t.me/s/KCryptoBTC168";
const binance = "https://fapi.binance.com";
const TG_TARGET = (Bun.env.TELEGRAM_TARGET_USERNAME || "twjavaleon").replace(/^@/,"").trim().toLowerCase();
const TELEGRAM_BOT_TOKEN = (Bun.env.TELEGRAM_BOT_TOKEN || "").trim();
const DONCHIAN_STATS_URL = (Bun.env.BINANCE_DEMO_STATS_URL || "").trim();
const DONCHIAN_STATS_TOKEN = (Bun.env.STATS_SHARED_TOKEN || "").trim();
const START_BALANCE = 10000;
const RISK = 0.01;
const MAX_POSITION = 0.20;
const FEE = 0.0004;
const SLIP = 0.0002;
// Auto close when net return reaches +1% of remaining entry notional after entry/exit fees and simulated exit slippage.
const NET_TAKE_PROFIT = 0.01;
const AGE = 5 * 60 * 1000;
const TTL = 24 * 60 * 60 * 1000;
const nowISO = () => new Date().toISOString();
const fresh = () => ({
version: 1, initialized: false, lastSeenId: 0, lastChannelPollAt: null,
lastPricePollAt: null, channelError: null, priceError: null,
messages: [], orders: [], quotes: {}, snapshots: [], notifications: [], telegram: { chatId:null, boundUsername:null, botUsername:null, pairingCode:null, boundAt:null, updateOffset:0, error:null, lastSentAt:null, delivered:0 }
});
mkdirSync(dirname(path), { recursive: true });
let state = fresh();
let donchianStatsCache = {data:null,error:null,lastSuccessAt:null};
if (existsSync(path)) {
const read = JSON.parse(readFileSync(path, "utf8"));
state = { ...fresh(), ...read };
}
console.info("TELEGRAM_BINDING_STATE", JSON.stringify({botUsername:state.telegram?.botUsername||null,paired:!!state.telegram?.chatId,target:"@"+TG_TARGET,botTokenConfigured:!!TELEGRAM_BOT_TOKEN}));
console.info("TELEGRAM_OUTBOX_AUDIT",JSON.stringify({total:state.notifications?.length||0,delivered:state.notifications?.filter(n=>n.status==="delivered").length||0,pending:state.notifications?.filter(n=>n.status==="pending").length||0,latest:(state.notifications||[]).slice(-12).map(n=>({key:n.key,status:n.status,attempts:n.attempts,createdAt:n.createdAt,deliveredAt:n.deliveredAt}))}));
function persist() {
const temp = path + ".tmp";
writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
renameSync(temp, path);
}

function tgState() {
state.telegram ||= { chatId:null, boundUsername:null, botUsername:null, pairingCode:null, boundAt:null, updateOffset:0, error:null, lastSentAt:null, delivered:0 };
state.notifications ||= [];
return state.telegram;
}
let notificationsMutedForStartupTests = false;
function queueNotice(key, message) {
if (notificationsMutedForStartupTests) return false;
if (!tgState().chatId) return false; // Do not notify unpaired/baseline history.
const notices = state.notifications;
if (notices.some(n => n.key===key)) return false;
notices.push({ key, text:String(message).slice(0,3900), createdAt:nowISO(),
deliveredAt:null, attempts:0, retryAt:0, status:"pending", lastError:null });
// Keep delivered event keys for deduplication; cap storage.
if(notices.length>4000) {
const delivered=notices.filter(n=>n.status==="delivered").slice(-2500);
state.notifications=[...notices.filter(n=>n.status!=="delivered"),...delivered];
}
return true;
}
const tgTradeLink = o => "https://t.me/KCryptoBTC168/" + o.messageId;
const tgNumber = (n,d=4) => Number(n||0).toLocaleString("en-US",{maximumFractionDigits:d});
function notifyOrderStatus(o) {
if (!Number.isSafeInteger(o?.messageId) || o.messageId<=0) return false;
if(["rejected","expired","cancelled"].includes(o.status)){
return queueNotice("order:"+o.messageId+":"+o.status,
"📌 模擬交易狀態更新\n"+
"交易："+o.symbol+" "+(o.side==="long"?"多單":"空單")+
"\n狀態："+({rejected:"拒絕",expired:"掛單到期",cancelled:"已取消"}[o.status])+
"\n原因："+o.reason+"\n原訊號："+tgTradeLink(o));
}
return false;
}
function notifyNewChannelItem(m) {
const o=state.orders.find(x=>x.messageId===m.id);
if(m.classification==="trade_signal_accepted" && o) {
queueNotice("signal:"+m.id,
"📡 K哥頻道新模擬訊號\n"+
o.symbol+" "+(o.side==="long"?"做多":"做空")+"\n"+
"價格區間："+tgNumber(o.entryLow)+"–"+tgNumber(o.entryHigh)+
"\n止損："+tgNumber(o.stop)+
"\n狀態："+(o.status==="pending"?"等待限價觸發":"等待有效市價")+
"\n模式：Paper Only · 扣費淨利達 1% 自動平倉\n"+
tgTradeLink(o));
} else if(m.classification==="cancelled_order" && m.replyTo) {
const original=state.orders.find(x=>x.messageId===m.replyTo);
if(original) notifyOrderStatus(original);
} else if(["partial_close_requested","full_close_requested"].includes(m.classification)) {
queueNotice("channel_action:"+m.id,
"📝 K哥頻道平倉指令\n"+
(m.classification==="partial_close_requested"?"收到減倉要求":"收到平倉要求")+
"\n等待有效市場報價執行模擬指令\n"+
"原單：https://t.me/KCryptoBTC168/"+m.replyTo+
"\n回覆：https://t.me/KCryptoBTC168/"+m.id);
} else if(["orphan_reply_needs_review","invalid_close_fraction","unlinked_exit_needs_review"].includes(m.classification)){
queueNotice("channel_review:"+m.id,
"⚠️ 頻道訊號待人工確認\n分類："+m.classification+
"\n內容："+m.text.slice(0,160)+"\nhttps://t.me/KCryptoBTC168/"+m.id);
}
}
function notifyOpened(o) {
if (!Number.isSafeInteger(o?.messageId) || o.messageId<=0) return false;
queueNotice("open:"+o.messageId,
"🟢 模擬建倉\n"+
o.symbol+" "+(o.side==="long"?"做多":"做空")+
"\n成交價："+tgNumber(o.entryPrice,6)+
"\n數量："+tgNumber(o.qty,6)+
"\n名目金額："+tgNumber(o.qty*o.entryPrice,2)+" USDT"+
"\n止損："+tgNumber(o.stop)+
"\n扣費淨利 +1% 自動全部平倉"+
"\n目標標記價（估算）："+tgNumber(o.onePctNetTargetMark,6)+
"\n原訊號："+tgTradeLink(o));
}
function notifyExit(o, leg) {
if (!Number.isSafeInteger(o?.messageId) || o.messageId<=0) return false;
const partial=o.status==="open";
const pct=(leg.netPnl/(leg.qty*o.entryPrice))*100;
queueNotice("exit:"+o.messageId+":"+o.exitEvents.length,
(leg.reason==="stop_loss"?"🛑 模擬止損":leg.reason==="net_take_profit_1pct"?"🎯 淨利 1% 自動止盈":partial?"🟡 模擬部分平倉":"✅ 模擬平倉")+
"\n"+o.symbol+" "+(o.side==="long"?"多單":"空單")+
"\n平倉價："+tgNumber(leg.price,6)+
"\n平倉數量："+tgNumber(leg.qty,6)+
"\n本次已實現淨損益："+(leg.netPnl>=0?"+":"")+tgNumber(leg.netPnl,4)+" USDT"+
"\n本次報酬："+(pct>=0?"+":"")+tgNumber(pct,3)+"%"+
"\n剩餘數量："+tgNumber(o.qty,6)+
"\n原因："+leg.reason+
"\n原訊號："+tgTradeLink(o));
}
function notifyServiceIssue(kind, prev, next) {
if(prev===next) return;
const text=next?"⚠️ "+kind+" 資料連線異常\n"+String(next).slice(0,350):
"✅ "+kind+" 連線已恢復";
queueNotice("health:"+kind+":"+Date.now()+":"+(next?"error":"recovery"),text);
}
function pairingMatches(msg,tg) {
const user=String(msg?.from?.username||"").toLowerCase();
const body=String(msg?.text||"").trim();
const match=body.match(/^\/start\s+([A-Za-z0-9_-]{16,64})$/);
if (user!==TG_TARGET || msg?.chat?.type!=="private" || !match || !tg?.pairingCode) return false;
const got=Buffer.from(match[1]),expected=Buffer.from(tg.pairingCode);
return got.length===expected.length && timingSafeEqual(got,expected);
}
function telegramStatus() {
const t=tgState();
const notices=state.notifications||[];
return {targetUsername:"@"+TG_TARGET, botTokenConfigured:!!TELEGRAM_BOT_TOKEN,
paired:!!t.chatId, pairedAt:t.boundAt||null, botUsername:t.botUsername||null,
queued:notices.filter(x=>x.status!=="delivered").length, delivered:t.delivered||0,
lastSentAt:t.lastSentAt||null, lastError:t.error||null };
}
function publicTelegramStatus() {
const s=telegramStatus();
return {targetUsername:s.targetUsername,paired:s.paired,botUsername:s.botUsername,
queued:s.queued,delivered:s.delivered,lastSentAt:s.lastSentAt};
}
function telegramSetup() {
const status=telegramStatus();
if(!status.botTokenConfigured || status.paired) return status;
const t=tgState();
if(!t.pairingCode){t.pairingCode=randomBytes(18).toString("hex");persist();}
return {...status,
startUrl:t.botUsername?"https://t.me/"+t.botUsername+"?start="+t.pairingCode:null,
readyToPair:!!t.botUsername};
}
async function telegramApi(method,payload) {
if(!TELEGRAM_BOT_TOKEN) throw Error("Telegram bot not configured");
const res=await fetch("https://api.telegram.org/bot"+TELEGRAM_BOT_TOKEN+"/"+method,{
method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)
});
let data=null;
try { data=await res.json(); } catch {}
if(!res.ok || !data?.ok){
const err=new Error("Telegram API "+method+" HTTP "+res.status+" "+String(data?.description||"").slice(0,100));
err.retryAfter=Number(data?.parameters?.retry_after)||0;
throw err;
}
return data.result;
}
function confirmInboundTelegramHealthy(t) {
// Inbound success must never clear a failed outgoing send or manufacture a recovery notice.
t.pollError = null;
}
let tgBusy=false;
async function telegramPolling() {
if(tgBusy)return;
tgBusy=true;
try {
if(TELEGRAM_BOT_TOKEN) {
const t=tgState();
if(!t.botUsername){
const me=await telegramApi("getMe",{});
if(!/^[a-zA-Z][\w]{4,31}$/.test(me.username||""))throw Error("Invalid Telegram bot username");
t.botUsername=me.username;
persist();
console.info("TELEGRAM_BOT_READY",JSON.stringify({bot:"@"+t.botUsername,target:"@"+TG_TARGET,paired:!!t.chatId}));
}
if(!t.chatId){
// Dedicated bot required: polling cannot run alongside an existing webhook.
const updates=await telegramApi("getUpdates",{
offset:t.updateOffset||0,limit:50,timeout:0,allowed_updates:["message"]
});
let changed=false;
for(const update of updates){
t.updateOffset=Math.max(t.updateOffset||0,Number(update.update_id)+1);
changed=true;
if(!t.chatId && pairingMatches(update.message,t)){
t.chatId=String(update.message.chat.id);
t.boundUsername=TG_TARGET;
t.boundAt=nowISO();
t.pairingCode=null;
console.info("TELEGRAM_BOT_PAIRED",JSON.stringify({bot:"@"+t.botUsername,username:"@"+TG_TARGET,pairedAt:t.boundAt}));
queueNotice("telegram:paired:"+t.chatId,
"✅ K Signal Paper Lab 推播綁定成功！\n接收帳號：@"+TG_TARGET+
"\n今後新的模擬建倉、減倉、止盈、止損和重要異常會在這裡通知。\n只模擬，不下真單。");
}
}
if(changed)persist();
}
// Successful bot metadata / inbound polling does not prove outbound sendMessage recovered.
// Leave any send error intact until a verified sendMessage success clears it.
confirmInboundTelegramHealthy(t);
}
} catch(err) {
const t=tgState();
t.error=String(err?.message||err).replaceAll(TELEGRAM_BOT_TOKEN||"__NEVER__","[redacted]").slice(0,350);
console.error("TELEGRAM_SETUP_ERROR",t.error);
persist();
} finally {tgBusy=false;}
}
let tgSendBusy=false;
async function flushTelegramOutbox() {
if(tgSendBusy || !TELEGRAM_BOT_TOKEN || !tgState().chatId)return;
tgSendBusy=true;
try {
const t=tgState();
const pending=(state.notifications||[]).filter(n=>n.status!=="delivered" &&
n.status!=="paused" && Date.now()>=(n.retryAt||0)).slice(0,4);
for(const n of pending){
try {
await telegramApi("sendMessage",{
chat_id:t.chatId,text:n.text,disable_web_page_preview:true
});
n.status="delivered"; n.deliveredAt=nowISO();n.lastError=null;
t.delivered=(t.delivered||0)+1;t.lastSentAt=n.deliveredAt;t.error=null;
persist();
console.info("TELEGRAM_DELIVERED",JSON.stringify({eventKey:n.key,deliveredAt:n.deliveredAt,totalDelivered:t.delivered}));
}catch(err) {
n.attempts=(n.attempts||0)+1;
n.lastError=String(err?.message||err).replaceAll(TELEGRAM_BOT_TOKEN,"[redacted]").slice(0,350);
n.retryAt=Date.now()+Math.max((Number(err?.retryAfter)||0)*1000,
Math.min(3600000,10000*Math.pow(2,Math.min(8,n.attempts))));
t.error=n.lastError;
if(n.attempts>=30)n.status="paused";
console.error("TELEGRAM_SEND_ERROR",n.lastError);
persist();
break;
}
}
} finally {tgSendBusy=false;}
}

function decode(s) {
return s.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
try { return String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : parseInt(n, 10)); }
catch { return ""; }
}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => (
({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[n] || ""
));
}
function plain(s) {
return decode(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
}
function parseChannel(html) {
const rx = /data-post="KCryptoBTC168\/(\d+)"/g;
const blocks = [...html.matchAll(rx)];
const result = [];
const seen = new Set();
for (let i = 0; i < blocks.length; i++) {
const id = Number(blocks[i][1]);
if (!Number.isSafeInteger(id) || seen.has(id)) continue;
seen.add(id);
const start = blocks[i].index;
const end = i + 1 < blocks.length ? blocks[i + 1].index : html.length;
const section = html.slice(start, end);
const body = section.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/);
const time = section.match(/<time[^>]+datetime="([^"]+)"/);
const reply = section.match(/tgme_widget_message_reply[\s\S]{0,1400}?KCryptoBTC168\/(\d+)/);
result.push({
id, text: body ? plain(body[1]) : "",
publishedAt: time && !isNaN(Date.parse(time[1])) ? new Date(time[1]).toISOString() : null,
replyTo: reply ? Number(reply[1]) : null
});
}
return result.sort((a, b) => a.id - b.id);
}
function signal(text) {
const tag = text.match(/#(BTC|ETH|SOL|ZEC|XRP|BNB|DOGE|AVAX|LINK|ADA|XAU)\b/i);
if (!tag) return { reason: "not_trade_signal" };
const token = tag[1].toUpperCase();
if (token === "XAU") return { reason: "unsupported_market_XAU" };
let kind = "";
if (/(掛單|挂单)/.test(text)) kind = "limit";
else if (/(市價|現價)/.test(text)) kind = "market";
else return { reason: "not_trade_signal" };
let side = "";
if (/(做空|附近空|小空|分批空)/.test(text)) side = "short";
else if (/(做多|附近多|小多|分批多)/.test(text)) side = "long";
else return { reason: "direction_unclear" };
const stop = text.match(/(?:止損|止损|\bSL\b)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/i);
if (!stop) return { reason: "stop_missing" };
const range = text.match(/([0-9]+(?:\.[0-9]+)?)\s*[-–~～]\s*([0-9]+(?:\.[0-9]+)?)/);
const single = text.match(/(?:市價|現價|挂单|掛單)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/);
if (!range && !single) return { reason: "entry_missing" };
const a = Number(range ? range[1] : single[1]);
const b = Number(range ? range[2] : single[1]);
const low = Math.min(a, b), high = Math.max(a, b), sl = Number(stop[1]);
if (!low || !high || !sl || (side === "long" && sl >= low) || (side === "short" && sl <= high))
return { reason: "invalid_risk_levels" };
const target = text.match(/(?:止盈|\bTP\b)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/i);
return { reason: "ok", symbol: token + "USDT", token, kind, side,
low, high, stop: sl, target: target ? Number(target[1]) : 0 };
}
const cancelMsg = s => /(取消掛單|取消挂单|撤單|撤单)/.test(s);
// An author's "profit" remark alone is NOT an exit instruction.
const closeMsg = s => /(?:^|\s)(?:止損|止损|止盈|平倉|平仓)(?:\s|$)/.test(s.trim()) ||
/(全部平倉|全部平仓|全平|清倉|清仓|減倉|减仓|部分止盈|獲利了結|获利了结|平掉|止盈一半|平一半|減半|减半|半倉|半仓)/.test(s);
const partialMsg = s => /(減倉|减仓|部分止盈|止盈一半|平一半|減半|减半|半倉|半仓|止盈\s*\d{1,3}(?:\.\d+)?\s*%)/.test(s);
function closeFraction(s) {
if (!partialMsg(s)) return 1;
const pct = s.match(/(?:減倉|减仓|部分止盈|止盈|平倉|平仓)\s*(\d{1,3}(?:\.\d+)?)\s*%/);
if (pct) { const n=Number(pct[1]); return n>0 && n<=100 ? n/100 : 0; }
if (/(一半|減半|减半|半倉|半仓|50\s*%)/.test(s)) return 0.5;
const fraction = s.match(/(?:減倉|减仓|止盈|平倉|平仓)\s*(\d+)\s*\/\s*(\d+)/);
if (fraction) return +fraction[1]>0 && +fraction[2]>0 && +fraction[1]<=+fraction[2] ? +fraction[1]/+fraction[2] : 0;
return 0.5; // Documented simulation assumption; never attributed to author.
}
function realizedShare(o) {
const initial = o.initialQty || o.qty || 0;
if (initial <= 0) return 0;
return o.status === "closed" ? 1 : Math.max(0,Math.min(1,(initial - o.qty)/initial));
}
function realizedOf(o) {
if(o.status === "closed") return o.netPnl || 0;
return (o.grossPnl || 0) - (o.feeExit || 0) - (o.feeEntry || 0) * realizedShare(o);
}
function unrealizedOf(o, price) {
return mark(o,price) - (o.feeEntry || 0) * (1 - realizedShare(o));
}
function exitLegs(o) {
if (o.exitEvents?.length) return o.exitEvents;
if (o.status === "closed") return [{at:o.exitTime,netPnl:o.netPnl||0,qty:o.initialQty||o.qty,reason:o.reason}];
return [];
}
const mark = (o, px) => o.side === "long" ? o.qty * (px - o.entryPrice) : o.qty * (o.entryPrice - px);
function equity() {
let v = START_BALANCE;
for (const o of state.orders) {
if (o.status === "closed") v += o.netPnl;
else if (o.status === "open") v += realizedOf(o) + unrealizedOf(o, state.quotes[o.symbol]?.price || o.entryPrice);
}
return v;
}
function snapshot() {
const t = Date.now();
const previous = state.snapshots[state.snapshots.length - 1];
if (!previous || t - Date.parse(previous.at) >= 60000) {
state.snapshots.push({ at: nowISO(), equity: equity() });
if (state.snapshots.length > 90000) state.snapshots = state.snapshots.slice(-90000);
}
}
function openOrder(o, price) {
if(!Number.isFinite(price) || price<=0 || !Number.isFinite(o.stop) || o.stop<=0 ||
!["long","short"].includes(o.side) || (o.side==="long" && o.stop>=price) ||
(o.side==="short" && o.stop<=price)) {
o.status="rejected"; o.reason="invalid_input_price_or_stop"; return;
}
const px = price * (o.side === "long" ? 1 + SLIP : 1 - SLIP);
const distance = Math.abs(px - o.stop);
const eq = Math.max(0, equity());
const riskQty = distance ? eq * RISK / distance : 0;
const used = state.orders.filter(x => x.status === "open")
.reduce((sum, x) => sum + x.qty * x.entryPrice, 0);
const qty = Math.min(riskQty, eq * MAX_POSITION / px, Math.max(0, eq - used) / px);
if (!Number.isFinite(qty) || qty <= 0) {
o.status = "rejected"; o.reason = "invalid_position_size"; return;
}
Object.assign(o, { status: "open", entryPrice: px, qty, initialQty: qty,
entryTime: nowISO(), feeEntry: qty * px * FEE, reason: "verified_mark_price_fill", exitEvents: [], pendingCloseCommands: [] });
o.onePctNetTargetMark = onePctNetTargetMark(o);
notifyOpened(o);
}

// Project the realized PnL *if the currently open quantity were closed* at this observed mark.
// Uses actual simulated entry fill price and allocated entry fee for the remaining quantity.
function projectedNetExitPnl(o, markPrice) {
if (o.status !== "open" || !Number.isFinite(markPrice) || markPrice <= 0 ||
!Number.isFinite(o.qty) || o.qty <= 0 || !Number.isFinite(o.entryPrice) || o.entryPrice <= 0)
return null;
const exitPrice = markPrice * (o.side === "long" ? 1 - SLIP : 1 + SLIP);
const gross = o.qty * (o.side === "long" ? exitPrice - o.entryPrice : o.entryPrice - exitPrice);
const entryFeeShare = (o.feeEntry || 0) * o.qty / (o.initialQty || o.qty);
const exitFee = o.qty * exitPrice * FEE;
return gross - entryFeeShare - exitFee;
}
function projectedNetReturn(o, markPrice) {
const pnl = projectedNetExitPnl(o, markPrice);
if (pnl === null) return null;
return pnl / (o.qty * o.entryPrice);
}
// Informational threshold only; the actual trigger checks the fees/slippage-adjusted net PnL.
function onePctNetTargetMark(o) {
if (o.status !== "open" || o.qty <= 0) return null;
const entryFeePerQty = (o.feeEntry || 0) / (o.initialQty || o.qty);
const price = o.side === "long"
? (o.entryPrice * (1 + NET_TAKE_PROFIT) + entryFeePerQty) / ((1-SLIP)*(1-FEE))
: (o.entryPrice * (1 - NET_TAKE_PROFIT) - entryFeePerQty) / ((1+SLIP)*(1+FEE));
return price > 0 && Number.isFinite(price) ? price : null;
}
function closeOrder(o, price, reason, fraction = 1, messageId = null, inferredRatio = false) {
if(o.status !== "open" || !Number.isFinite(fraction) || fraction <= 0 ||
!Number.isFinite(price) || price<=0) return;
const initial = o.initialQty || o.qty;
const quantity = Math.min(o.qty, o.qty * fraction);
const px = price * (o.side === "long" ? 1 - SLIP : 1 + SLIP);
const feeExit = quantity * px * FEE;
const grossPnl = (o.side === "long" ? px - o.entryPrice : o.entryPrice - px) * quantity;
const allocatedEntryFee = (o.feeEntry || 0) * quantity / initial;
const at = nowISO();
o.exitEvents ||= [];
o.exitEvents.push({ at, price: px, qty: quantity, fractionOfRemaining: fraction,
grossPnl, feeExit, allocatedEntryFee, netPnl: grossPnl-feeExit-allocatedEntryFee,
reason, messageId, assumedRatio: inferredRatio });
o.feeExit = (o.feeExit||0) + feeExit;
o.grossPnl = (o.grossPnl||0) + grossPnl;
o.qty = Math.max(0,o.qty-quantity);
if (o.qty <= Math.max(1e-12,initial * 1e-9)) {
o.qty = 0;
Object.assign(o, { status: "closed", exitPrice: px, exitTime: at,
netPnl: o.grossPnl - (o.feeEntry||0) - o.feeExit, reason,
pendingCloseCommands: [] });
} else {
o.netPnl = realizedOf(o);
o.reason = reason;
o.lastPartialTime = at;
}
notifyExit(o,o.exitEvents[o.exitEvents.length-1]);
}
function ingest(msgs, save = persist) {
const now = Date.now();
if (!state.initialized) {
state.messages = msgs.map(m => ({ ...m, classification: "historical_baseline", firstSeenAt: nowISO() }));
state.lastSeenId = Math.max(0, ...msgs.map(m => m.id));
state.initialized = true;
state.lastChannelPollAt = nowISO();
state.channelError = null;
snapshot(); save();
return;
}
const existing = new Map(state.messages.map((m, i) => [m.id, i]));
for (const msg of msgs) {
if (existing.has(msg.id)) {
const old = state.messages[existing.get(msg.id)];
if ((old.latestText || old.text) !== msg.text) {
old.latestText = msg.text;
old.editedAt = nowISO();
old.note = "Original retained; edit requires manual review";
queueNotice("telegram:edit:"+msg.id+":"+msg.text,
"✏️ 原頻道訊息已編輯，需要人工檢視；系統不會重算既有模擬成交。\nhttps://t.me/KCryptoBTC168/"+msg.id);
}
continue;
}
const m = { ...msg, firstSeenAt: nowISO(), classification: "" };
if (m.id <= state.lastSeenId) m.classification = "late_history_ignored";
else if (!m.publishedAt || Date.parse(m.publishedAt) > now + 120000 ||
now - Date.parse(m.publishedAt) > AGE) m.classification = "stale_or_missing_timestamp";
else if (m.replyTo && (cancelMsg(m.text) || closeMsg(m.text))) {
const o = state.orders.find(x => x.messageId === m.replyTo);
if (!o) m.classification = "orphan_reply_needs_review";
else if (cancelMsg(m.text) && (o.status === "pending" || o.status === "waiting_price")) {
o.status = "cancelled"; o.reason = "channel_cancelled_before_fill"; m.classification = "cancelled_order";
} else if (closeMsg(m.text) && o.status === "open") {
const f = closeFraction(m.text);
if (!(f > 0 && f <= 1)) m.classification = "invalid_close_fraction";
else {
o.pendingCloseCommands ||= [];
// Commands are uniquely keyed by Telegram message, avoiding double exits.
if (!o.pendingCloseCommands.some(x=>x.messageId===m.id) &&
!o.exitEvents?.some(x=>x.messageId===m.id)) {
o.pendingCloseCommands.push({ messageId:m.id, fraction:f,
reason:partialMsg(m.text)?"channel_partial_take_profit":"channel_close",
inferredRatio:partialMsg(m.text) && !/(\d+\s*%|一半|減半|减半|半倉|半仓|\d+\s*\/\s*\d+)/.test(m.text) });
}
m.classification = partialMsg(m.text) ? "partial_close_requested" : "full_close_requested";
}
} else m.classification = "needs_review";
} else {
const s = signal(m.text);
m.classification = !m.replyTo && s.reason === "not_trade_signal" && (closeMsg(m.text)||cancelMsg(m.text)) ? "unlinked_exit_needs_review" : s.reason;
if (s.reason === "ok") {
state.orders.push({
id: "K" + m.id, messageId: m.id, symbol: s.symbol, side: s.side, kind: s.kind,
status: s.kind === "limit" ? "pending" : "waiting_price",
entryLow: s.low, entryHigh: s.high, stop: s.stop, target: s.target,
receivedAt: nowISO(), publishedAt: m.publishedAt, reason: "awaiting_verified_price",
qty: 0, initialQty: 0, entryPrice: 0, exitPrice: 0, feeEntry: 0, feeExit: 0, grossPnl: 0, netPnl: 0,
exitEvents: [], pendingCloseCommands: [], netTakeProfitPct: NET_TAKE_PROFIT*100
});
m.classification = "trade_signal_accepted";
}
}
notifyNewChannelItem(m);
state.messages.push(m);
if (m.id > state.lastSeenId) state.lastSeenId = m.id;
}
state.lastChannelPollAt = nowISO();
state.channelError = null;
save();
}
async function fetchChannel() {
const r = await fetch(source, { signal: AbortSignal.timeout(25000),
headers: { "User-Agent": "Mozilla/5.0 (compatible; KSignalPaperLab/1.0)" } });
if (!r.ok) throw new Error("Telegram public page HTTP " + r.status);
const text = await r.text();
const msgs = parseChannel(text);
if (!msgs.length) throw new Error("Telegram returned no parseable posts");
return msgs;
}
async function fetchPrice(sym) {
const r = await fetch(binance + "/fapi/v1/premiumIndex?symbol=" + encodeURIComponent(sym),
{ signal: AbortSignal.timeout(12000) });
if (!r.ok) throw new Error("Binance " + sym + " HTTP " + r.status);
const data = await r.json();
const price = Number(data.markPrice);
if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid mark price for " + sym);
return price;
}
let lastPriceLogAt = 0;
let syntheticTestMode = false;
function handlePrice(sym, price) {
if(!Number.isFinite(price) || price<=0) return;
const t = Date.now();
state.quotes[sym] = { price, at: nowISO() };
if (!syntheticTestMode && sym === "BTCUSDT" && Date.now()-lastPriceLogAt > 300000) { console.info("PRICE_SYNC",JSON.stringify({symbol:sym,price,at:state.quotes[sym].at})); lastPriceLogAt=Date.now(); }
for (const o of state.orders) {
if (o.symbol !== sym) continue;
if (o.status === "waiting_price") {
if (t - Date.parse(o.receivedAt) > AGE) {
o.status = "rejected"; o.reason = "quote_arrived_too_late"; notifyOrderStatus(o);
} else if (price < o.entryLow || price > o.entryHigh) {
o.status = "rejected"; o.reason = "market_price_outside_entry_range"; notifyOrderStatus(o);
} else openOrder(o, price);
} else if (o.status === "pending") {
if (t - Date.parse(o.receivedAt) > TTL) {
o.status = "expired"; o.reason = "pending_ttl"; notifyOrderStatus(o);
} else if (price >= o.entryLow && price <= o.entryHigh) openOrder(o, price);
} else if (o.status === "open") {
// Apply hard stop before discretionary channel closes at the observed quote.
if ((o.side === "long" && price <= o.stop) ||
(o.side === "short" && price >= o.stop)) closeOrder(o, price, "stop_loss");
else if (o.target > 0 && ((o.side === "long" && price >= o.target) ||
(o.side === "short" && price <= o.target)) &&
projectedNetReturn(o, price) >= NET_TAKE_PROFIT)
closeOrder(o, price, "take_profit");
else if (projectedNetReturn(o, price) >= NET_TAKE_PROFIT)
closeOrder(o, price, "net_take_profit_1pct");
else {
// Backward compatibility with a pending full-close request from the previous version.
if(o.reason === "channel_close_requested" && !o.pendingCloseCommands?.length)
closeOrder(o, price, "channel_close");
while(o.status === "open" && o.pendingCloseCommands?.length) {
const cmd = o.pendingCloseCommands.shift();
closeOrder(o, price, cmd.reason, cmd.fraction, cmd.messageId, cmd.inferredRatio);
}
}
}
}
}
let channelBusy = false, pricesBusy = false;
async function pollChannel() {
if (channelBusy) return;
channelBusy = true;
const previousChannelError=state.channelError;
try { const messages = await fetchChannel(); ingest(messages); notifyServiceIssue("Telegram 頻道",previousChannelError,null); persist(); console.info("CHANNEL_SYNC", JSON.stringify({count:messages.length,lastSeenId:state.lastSeenId,initialized:state.initialized,orders:state.orders.length})); }
catch (err) { state.channelError = String(err.message || err); state.lastChannelPollAt = nowISO(); notifyServiceIssue("Telegram 頻道",previousChannelError,state.channelError); persist(); console.error("CHANNEL_ERROR",state.channelError); }
finally { channelBusy = false; }
}
async function pollPrices() {
if (pricesBusy) return;
pricesBusy = true;
try {
const t = Date.now();
const symbols = new Set(["BTCUSDT"]);
for (const o of state.orders) {
if (o.status === "pending" && t - Date.parse(o.receivedAt) > TTL) {
o.status = "expired"; o.reason = "pending_ttl";
} else if (o.status === "waiting_price" && t - Date.parse(o.receivedAt) > AGE) {
o.status = "rejected"; o.reason = "price_timeout"; notifyOrderStatus(o);
} else if (["open", "waiting_price", "pending"].includes(o.status)) symbols.add(o.symbol);
}
const failures = [];
for (const sym of symbols) {
try { handlePrice(sym, await fetchPrice(sym)); }
catch (err) { failures.push(sym + ": " + String(err.message || err)); }
}
const previousPriceError=state.priceError;
state.priceError = failures.length ? failures.join("; ") : null;
notifyServiceIssue("Binance 行情",previousPriceError,state.priceError);
if (failures.length) console.error("PRICE_ERRORS",state.priceError);
state.lastPricePollAt = nowISO();
snapshot(); persist();
} catch (err) { state.priceError = String(err.message || err); persist(); }
finally { pricesBusy = false; }
}
// The anonymous dashboard must not expose raw Donchian upstream objects.
const donchianPublicNumber = v => typeof v === "number" && Number.isFinite(v) ? v : null;
const donchianPublicStats = (source, fields) => Object.fromEntries(fields.map(k => [k, donchianPublicNumber(source?.[k])]));
const donchianPublicText = (v, pattern) => typeof v === "string" && pattern.test(v) ? v : null;
const donchianPublicTime = v => donchianPublicText(v,/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]{8,24}Z?$/);
const donchianPublicChart = v => donchianPublicText(v,/^https:\/\/www[.]tradingview[.]com\/chart\/[?]symbol=BINANCE%3A[A-Z0-9]{3,16}[.]P&interval=(?:15|60)$/);
function donchianPublicRows(source,closed=false) {
if (!Array.isArray(source)) return [];
return source.slice(0,100).filter(x => x && typeof x === "object" &&
typeof x.symbol === "string" && /^[A-Z0-9]{3,16}$/.test(x.symbol)).map(x => ({
symbol:x.symbol,side:donchianPublicText(x.side,/^(?:LONG|SHORT|long|short)$/),
strategyVersion:donchianPublicText(x.strategyVersion,/^[A-Z0-9_]{3,48}$/),
entryPrice:donchianPublicNumber(x.entryPrice),
entryTime:donchianPublicTime(x.entryTime),
chartUrl:donchianPublicChart(x.chartUrl),
...(closed ? {
referenceEntry:donchianPublicNumber(x.referenceEntry),
exitPrice:donchianPublicNumber(x.exitPrice),
exitReason:donchianPublicText(x.exitReason,/^[A-Z0-9_:-]{1,64}$/),
fees:donchianPublicNumber(x.fees),
netPnl:donchianPublicNumber(x.netPnl),
exitTime:donchianPublicTime(x.exitTime)
} : {
lastPrice:donchianPublicNumber(x.lastPrice),
lastPriceAt:donchianPublicTime(x.lastPriceAt),
stopLoss:donchianPublicNumber(x.stopLoss),
takeProfit:donchianPublicNumber(x.takeProfit),
paperPnl:donchianPublicNumber(x.paperPnl)
})
}));
}
function mergeDonchianStats(paper,remote=donchianStatsCache.data,cache=donchianStatsCache) {
const valid=remote?.ledger==="BINANCE_DEMO_DONCHIAN"&&remote?.schemaVersion===1;
const lastSuccessAt=donchianPublicTime(cache.lastSuccessAt);
const ageMs=lastSuccessAt ? Date.now()-Date.parse(lastSuccessAt) : Infinity;
const stale=valid&&(!!cache.error || !Number.isFinite(ageMs) || ageMs>90000 || ageMs < -30000);
return {...paper,donchianDemo:{
available:valid,
stale,lastSuccessAt,
error:cache.error ? (cache.error==="統計整合未設定" ? "統計整合未設定" : "Donchian 統計服務暫時無法取得") : null,
signals:valid?donchianPublicStats(remote.signals,["total","entries","exits"]):null,
performance:valid?donchianPublicStats(remote.performance,["closedTrades","wins","losses","winRatePct","grossRealized","commission","funding","netPnlUsdt"]):null,
paper:valid?donchianPublicStats(remote.paper,["initialBalance","equity","openPositions","closedTrades","wins","winRatePct","realizedPnl","unrealizedPnl"]):null,
positions:valid?donchianPublicRows(remote.advisoryPositions):[],
closedPositions:valid?donchianPublicRows(remote.closedPaperPositions,true):[]
}};
}
function report() {
const closed = state.orders.filter(o => o.status === "closed");
const open = state.orders.filter(o => o.status === "open");
const realized = [...closed,...open].reduce((v,o)=>v+realizedOf(o),0);
const unrealized = open.reduce((v, o) => v + unrealizedOf(o,state.quotes[o.symbol]?.price || o.entryPrice),0);
const partialExits = state.orders.reduce((v,o)=>v+(o.exitEvents||[]).filter(x=>x.fractionOfRemaining<1).length,0);
const wins = closed.filter(o => o.netPnl > 0);
const losses = closed.filter(o => o.netPnl < 0);
const exitPnls = state.orders.flatMap(o=>exitLegs(o).map(v=>v.netPnl||0));
const winGross = exitPnls.filter(v=>v>0).reduce((a,b)=>a+b,0);
const lossGross = -exitPnls.filter(v=>v<0).reduce((a,b)=>a+b,0);
let peak = START_BALANCE, maxDD = 0;
for (const x of state.snapshots) { peak = Math.max(peak, x.equity); if (peak > 0) maxDD = Math.max(maxDD, (peak - x.equity) / peak * 100); }
const daily = {}, monthly = {}, symbols = {};
for (const o of state.orders) for (const exit of exitLegs(o)) {
const day = (exit.at || "").slice(0, 10);
if(!day) continue;
const month = day.slice(0, 7);
daily[day] ||= { trades: 0, wins: 0, pnl: 0 };
monthly[month] ||= { trades: 0, wins: 0, pnl: 0 };
symbols[o.symbol] ||= { trades: 0, wins: 0, pnl: 0 };
for (const v of [daily[day], monthly[month], symbols[o.symbol]]) {
v.trades++; if (exit.netPnl > 0) v.wins++; v.pnl += exit.netPnl;
}
}
return mergeDonchianStats({
mode: "PAPER_ONLY", initialBalance: START_BALANCE, netTakeProfitPct: NET_TAKE_PROFIT*100, equity: equity(),
netReturnPct: (equity() / START_BALANCE - 1) * 100,
realizedPnl: realized, unrealizedPnl: unrealized,
openPositions: open.length, pendingOrders: state.orders.filter(x => x.status === "pending").length,
closedTrades: closed.length, partialExits, winRatePct: closed.length ? wins.length / closed.length * 100 : 0,
profitFactor: lossGross > 0 ? winGross / lossGross : null, maxDrawdownPct: maxDD,
feesPaid: state.orders.reduce((v, o) => v + (o.feeEntry || 0) + (o.feeExit || 0), 0),
daily, monthly, symbols, snapshots: state.snapshots.slice(-1000)
});
}
async function refreshDonchianStats(){
if(!DONCHIAN_STATS_URL||DONCHIAN_STATS_TOKEN.length<32){donchianStatsCache.error="統計整合未設定";return;}
try{
const r=await fetch(DONCHIAN_STATS_URL,{headers:{"x-stats-token":DONCHIAN_STATS_TOKEN},signal:AbortSignal.timeout(12000)});
if(!r.ok)throw Error("Demo stats HTTP "+r.status);
const data=await r.json();
if(data?.schemaVersion!==1||data?.ledger!=="BINANCE_DEMO_DONCHIAN")throw Error("Demo stats schema");
donchianStatsCache={data,error:null,lastSuccessAt:nowISO()};
}catch(err){donchianStatsCache.error=String(err.message||err).slice(0,180);}
}
// Public reporting boundary: an explicit allowlist keeps internal Paper state private.
// Only the seven fields used by the anonymous trade table are exposed.
function publicOrders() {
return state.orders.slice(-100).map(o=>({
messageId:Number.isSafeInteger(o.messageId)&&o.messageId>0?o.messageId:null,
symbol:typeof o.symbol==="string"&&/^[A-Z0-9]{3,16}$/.test(o.symbol)?o.symbol:null,
side:["long","short"].includes(o.side)?o.side:null,
status:typeof o.status==="string"&&/^[a-z_]{1,32}$/.test(o.status)?o.status:"unknown",
entryLow:Number.isFinite(o.entryLow)&&o.entryLow>0?o.entryLow:null,
entryHigh:Number.isFinite(o.entryHigh)&&o.entryHigh>0?o.entryHigh:null,
entryPrice:Number.isFinite(o.entryPrice)?o.entryPrice:null,
exitPrice:Number.isFinite(o.exitPrice)?o.exitPrice:null,
netPnl:Number.isFinite(o.netPnl)?o.netPnl:null
}));
}
function publicPaperStatus() {
return {
mode:"PAPER_ONLY",channel:"KCryptoBTC168",initialized:state.initialized,
lastSeenId:state.lastSeenId,lastChannelPollAt:state.lastChannelPollAt,
lastPricePollAt:state.lastPricePollAt,
channelError:state.channelError?"Telegram 頻道資料暫時無法取得":null,
priceError:state.priceError?"行情資料暫時無法取得":null,
messagesCaptured:state.messages.length,ordersTracked:state.orders.length
};
}
// Defend CSV viewers against spreadsheet formula execution and record splitting.
// Keep finite numeric values (including negative PnL) numeric; all other values are text.
function csvCell(value) {
const numeric = typeof value === "number" && Number.isFinite(value);
let text = String(value ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ");
if (!numeric && /^[\s\u200b\u2060\ufeff]*[=+\-@]/u.test(text)) text = "'" + text;
return '"' + text.replace(/"/g, '""') + '"';
}
// Public CSV is anonymous: project nested exit events, never serialize raw state objects.
// Preserve documented partial-close accounting, but drop debug/credential/unknown fields.
function publicCsvExitEvents(events) {
if (!Array.isArray(events)) return "[]";
const numericKeys = ["price","qty","fractionOfRemaining","grossPnl","feeExit","allocatedEntryFee","netPnl"];
return JSON.stringify(events.filter(e => e && typeof e === "object" && !Array.isArray(e)).map(e => {
const row = {};
for (const key of ["at","reason"]) if (typeof e[key] === "string") row[key] = e[key].slice(0,180);
for (const key of numericKeys) if (typeof e[key] === "number" && Number.isFinite(e[key])) row[key] = e[key];
if (Number.isSafeInteger(e.messageId) && e.messageId > 0) row.messageId = e.messageId;
if (typeof e.assumedRatio === "boolean") row.assumedRatio = e.assumedRatio;
return row;
}));
}
function csv() {
const fields = ["messageId", "symbol", "side", "kind", "status", "entryLow", "entryHigh",
"entryPrice", "stop", "target", "qty", "exitPrice", "feeEntry", "feeExit",
"grossPnl", "netPnl", "receivedAt", "entryTime", "exitTime", "reason", "initialQty", "lastPartialTime", "exitEvents"];
return [fields.join(","), ...state.orders.map(o => fields.map(k => {
const v = k === "messageId"
? (Number.isSafeInteger(o[k]) && o[k] > 0 ? "https://t.me/KCryptoBTC168/" + o[k] : "")
: (k === "exitEvents" ? publicCsvExitEvents(o[k]) : (o[k] ?? ""));
return csvCell(v);
}).join(","))].join("\n");
}
function json(value) {
return Response.json(value, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function authOk(req) {
const auth = req.headers.get("authorization") || "";
if (!auth.startsWith("Basic ")) return false;
let pair;
try { pair = atob(auth.slice(6)).split(":"); } catch { return false; }
const got = Buffer.from(pair.slice(1).join(":"));
const expected = Buffer.from(password);
return got.length === expected.length && timingSafeEqual(got, expected);
}

function runBDDTests() {
const results = [], savedState = state;
const assert = (condition, detail) => { if (!condition) throw Error(detail); };
const near = (a,b,e=1e-7) => assert(Math.abs(a-b) <= e, "expected "+a+" ≈ "+b);
const current = () => nowISO();
const mock = (override = {}) => ({
id:"K5001",messageId:5001,symbol:"SOLUSDT",side:"long",kind:"limit",
status:"pending",entryLow:99,entryHigh:101,stop:95,target:0,
receivedAt:current(),publishedAt:current(),qty:0,initialQty:0,
entryPrice:0,exitPrice:0,feeEntry:0,feeExit:0,grossPnl:0,netPnl:0,
exitEvents:[],pendingCloseCommands:[],reason:"awaiting_verified_price",
...override
});
const test = (name, fn) => {
state = fresh(); state.initialized = true; state.lastSeenId = 5000; syntheticTestMode = true;
try { fn(); results.push({ scenario:name, pass:true }); }
catch(err) { results.push({ scenario:name, pass:false, detail:String(err.message||err) }); }
finally { state = savedState; syntheticTestMode = false; }
};
test("BDD01", () => {
state = fresh();
ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:current(),replyTo:null}],()=>{});
assert(state.initialized && state.lastSeenId===5001 && state.orders.length===0,"baseline must not place orders");
});
test("BDD02", () => {
const x=signal("#ZEC 市價 1225-1200附近小多（20-30x） 止損 1168");
assert(x.reason==="ok" && x.symbol==="ZECUSDT" && x.side==="long" &&
x.kind==="market" && x.low===1200 && x.high===1225 && x.stop===1168,"long parse error");
});
test("BDD03", () => {
const x=signal("#ZEC 掛單 1250-1265附近空 止損 1288");
assert(x.reason==="ok" && x.side==="short" && x.kind==="limit" &&
x.low===1250 && x.high===1265,"short parse error");
});
test("BDD04", () => {
const x=signal("#SOL 市價 99-101附近多");
assert(x.reason==="stop_missing","missing SL accepted");
});
test("BDD05", () => {
state.lastSeenId=5000;
const msg={id:5001,text:"#SOL 市價 99-101附近多 止損 95",
publishedAt:current(),replyTo:null};
ingest([msg],()=>{});
assert(state.orders.length===1 && state.orders[0].status==="waiting_price", "market order should await price");
ingest([msg],()=>{});
assert(state.orders.length===1,"duplicate message created duplicate order");
});
test("BDD06", () => {
const o=mock({status:"waiting_price"});state.orders=[o];
handlePrice("SOLUSDT",100);
assert(o.status==="open" && o.qty>0 && o.entryPrice>100, "market entry failed");
});
test("BDD07", () => {
const o=mock({status:"waiting_price"});state.orders=[o];
handlePrice("SOLUSDT",105);
assert(o.status==="rejected" && !o.qty,"out-of-range market order filled");
});
test("BDD08", () => {
const o=mock();state.orders=[o];
handlePrice("SOLUSDT",120);
assert(o.status==="pending","out-of-range limit filled");
handlePrice("SOLUSDT",100);
assert(o.status==="open","limit was not filled in range");
});
test("BDD09", () => {
const o=mock({receivedAt:new Date(Date.now()-25*3600*1000).toISOString()});
state.orders=[o];handlePrice("SOLUSDT",100);
assert(o.status==="expired","old order filled");
});
test("BDD10", () => {
const o=mock();state.orders=[o];state.lastSeenId=5001;
ingest([{id:5002,text:"取消掛單 沒有接到",replyTo:5001,publishedAt:current()}],()=>{});
assert(o.status==="cancelled" && state.orders.length===1,"cancel reply failed");
});
test("BDD11", () => {
const o=mock({status:"waiting_price",receivedAt:new Date(Date.now()-AGE-3000).toISOString()});
state.orders=[o];handlePrice("SOLUSDT",100);
assert(o.status==="rejected","stale market quote filled");
});
test("BDD12", () => {
const o=mock();state.orders=[o];openOrder(o,100);
assert(o.qty*o.entryPrice<=START_BALANCE*MAX_POSITION+1e-5,"position cap exceeded");
assert(o.qty*Math.abs(o.entryPrice-o.stop)<=START_BALANCE*RISK+1e-5,"risk cap exceeded");
});
test("BDD13", () => {
const o=mock();state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",94);
assert(o.status==="closed" && o.reason==="stop_loss" && o.exitPrice<94 && o.netPnl<0,"long stop wrong");
});
test("BDD14", () => {
const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",106);
assert(o.status==="closed" && o.exitPrice>106 && o.netPnl<0,"short stop wrong");
});
test("BDD15", () => {
const o=mock({target:110});state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",111);
assert(o.status==="closed" && o.reason==="take_profit" && o.netPnl>0,"long TP wrong");
});
test("BDD16", () => {
const o=mock({side:"short",stop:105,target:90});state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",89);
assert(o.status==="closed" && o.reason==="take_profit" && o.netPnl>0,"short TP wrong");
});
test("BDD17", () => {
assert(closeMsg("兩倍了 減倉") && !closeMsg("賺錢了 兄弟們"),"exit text classification wrong");
near(closeFraction("兩倍了 減倉"),0.5);
const o=mock();state.orders=[o];openOrder(o,100);
const initial=o.qty;
closeOrder(o,110,"channel_partial_take_profit",0.5,5002,true);
near(o.qty,initial/2);
assert(o.status==="open" && o.exitEvents[0].assumedRatio &&
realizedOf(o)>0,"partial exit not realized");
});
test("BDD18", () => {
near(closeFraction("減倉 30%"),0.3);
near(closeFraction("平一半"),0.5);
near(closeFraction("減倉 1/3"),1/3);
});
test("BDD19", () => {
const o=mock();state.orders=[o];openOrder(o,100);
state.lastSeenId=5001;
ingest([{id:5002,text:"兩倍了 減倉",replyTo:5001,publishedAt:current()}],()=>{});
assert(o.pendingCloseCommands.length===1 && o.status==="open","reply queue failed");
handlePrice("SOLUSDT",100.5);
assert(o.status==="open" && o.exitEvents.length===1 && o.qty<o.initialQty,"reply not executed");
});
test("BDD20", () => {
const o=mock();state.orders=[o];openOrder(o,100);
state.lastSeenId=5001;
const msg={id:5002,text:"兩倍了 減倉",replyTo:5001,publishedAt:current()};
ingest([msg],()=>{}); handlePrice("SOLUSDT",100.5);ingest([msg],()=>{});
handlePrice("SOLUSDT",100.6);
assert(o.exitEvents.length===1,"duplicate reply doubled exit");
});
test("BDD21", () => {
const o=mock();state.orders=[o];openOrder(o,100);state.lastSeenId=5001;
ingest([{id:5002,text:"全部平倉",replyTo:5001,publishedAt:current()}],()=>{});
handlePrice("SOLUSDT",100.5);
assert(o.status==="closed" && o.qty===0 && o.exitEvents.length===1 &&
o.netPnl>0,"full close failed");
});
test("BDD22", () => {
const o=mock();state.orders=[o];openOrder(o,100);
const entryQty=o.qty;closeOrder(o,110,"partial",0.5,5002,true);
const rep=report();const expectedRealized=o.exitEvents[0].netPnl;
near(rep.realizedPnl,expectedRealized);
near(rep.unrealizedPnl,unrealizedOf(o,o.entryPrice));
near(rep.equity,START_BALANCE+rep.realizedPnl+rep.unrealizedPnl);
near(o.qty,entryQty/2);
});
test("BDD23", () => {
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"partial",0.5,5002,true);
handlePrice("SOLUSDT",94);
assert(o.status==="closed" && o.exitEvents.length===2,"remaining stop missing");
near(o.netPnl,o.exitEvents.reduce((sum,x)=>sum+x.netPnl,0));
near(equity(),START_BALANCE+o.netPnl);
});
test("BDD24", () => {
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"partial",0.5,5002,true);
closeOrder(o,108,"full",1,5003,false);
const r=report(),d=current().slice(0,10),m=d.slice(0,7);
assert(r.daily[d].trades===2 && r.monthly[m].trades===2 &&
r.partialExits===1,"leg-count mismatch");
near(r.daily[d].pnl,o.netPnl);
near(r.symbols.SOLUSDT.pnl,o.netPnl);
});
test("BDD25", () => {
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"take_profit");
assert(o.feeEntry>0 && o.feeExit>0 &&
o.netPnl<o.grossPnl && o.entryPrice>100 && o.exitPrice<110,
"fees/slippage not charged");
});
test("BDD26", () => {
const html='<div data-post="KCryptoBTC168/5001"><div class="tgme_widget_message_text js-message_text">#SOL<br>市價 99-101附近多 止損 95</div><time datetime="'+current()+'"></time></div>'+
'<div data-post="KCryptoBTC168/5002"><a class="tgme_widget_message_reply" href="https://t.me/KCryptoBTC168/5001">quoted</a>'+
'<div class="tgme_widget_message_text js-message_text">兩倍了 減倉</div><time datetime="'+current()+'"></time></div>';
const x=parseChannel(html);
assert(x.length===2 && x[1].replyTo===5001 && x[1].text==="兩倍了 減倉","reply parsing mismatch");
});
test("BDD27", () => {
state.lastSeenId=5000;
ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",
publishedAt:new Date(Date.now()-15*60*1000).toISOString(),replyTo:null}],()=>{});
assert(state.orders.length===0 && state.messages[0].classification==="stale_or_missing_timestamp","stale message accepted");
});
test("BDD28", () => {
const o=mock();state.orders=[o];openOrder(o,100);state.lastSeenId=5001;
ingest([{id:5002,text:"賺錢了兄弟們",replyTo:5001,publishedAt:current()}],()=>{});
handlePrice("SOLUSDT",100.5);
assert(o.status==="open" && o.exitEvents.length===0,"profit comment caused exit");
});

// Parsing and Telegram ingestion — synthetic messages only.
test("BDD29",()=>{
const x=signal("#sol 市價 99-101附近多 止損 95");
assert(x.reason==="ok" && x.symbol==="SOLUSDT","lowercase ticker not normalized");
});
test("BDD30",()=>{
const x=signal("#XAU 市價 4000-4010附近多 止損 3900");
assert(x.reason==="unsupported_market_XAU","unsupported gold market accepted");
});
test("BDD31",()=>{
assert(signal("#NOTREAL 市價 99-101附近多 止損 95").reason==="not_trade_signal","unknown ticker accepted");
});
test("BDD32",()=>{
assert(signal("#BTC 長期趨勢仍可能看多").reason==="not_trade_signal","commentary traded");
});
test("BDD33",()=>{
assert(signal("#SOL 市價 99-101附近多 止損 102").reason==="invalid_risk_levels","bad long stop accepted");
});
test("BDD34",()=>{
assert(signal("#SOL 市價 99-101附近多 止損 99").reason==="invalid_risk_levels","zero long stop gap accepted");
});
test("BDD35",()=>{
assert(signal("#SOL 掛單 99-101附近空 止損 101").reason==="invalid_risk_levels","zero short stop gap accepted");
});
test("BDD36",()=>{
const x=signal("#BTC 掛單 80000-79000附近多 止損 78000");
assert(x.reason==="ok" && x.low===79000 && x.high===80000,"reverse range not normalized");
});
test("BDD37",()=>{
const x=signal("#BTC 市價 78500附近多 止損 77200");
assert(x.reason==="ok" && x.low===78500 && x.high===78500,"single entry failed");
});
test("BDD38",()=>{
const x=signal("#SOL 市價 99-101附近多 止損 95 止盈 120");
assert(x.reason==="ok" && x.target===120,"take profit target missing");
});
test("BDD39",()=>{
assert(signal("#SOL 市價附近多 止損 95").reason==="entry_missing","missing entry accepted");
});
test("BDD40",()=>{
assert(signal("   ").reason==="not_trade_signal","blank signal accepted");
});
test("BDD41",()=>{
const html='<div data-post="KCryptoBTC168/5010"><div class="tgme_widget_message_text js-message_text">A</div></div>'+
'<div data-post="KCryptoBTC168/5010"><div class="tgme_widget_message_text js-message_text">B</div></div>';
const x=parseChannel(html);
assert(x.length===1 && x[0].id===5010,"duplicate channel item");
});
test("BDD42",()=>{
assert(plain("#BTC &amp; SOL<br>止損 &lt; 80")==="#BTC & SOL\n止損 < 80","entity/br decoder broken");
});
test("BDD43",()=>{
const h='<div data-post="KCryptoBTC168/5002"><a class="tgme_widget_message_reply" href="https://t.me/KCryptoBTC168/5001">'+
'<div class="tgme_widget_message_text js-message_reply_text">#SOL 市價 99-101附近多 止損 95</div></a>'+
'<div class="tgme_widget_message_text js-message_text">減倉</div><time datetime="'+current()+'"></time></div>';
const x=parseChannel(h);
assert(x.length===1 && x[0].text==="減倉" && x[0].replyTo===5001,"reply text overwritten");
});
test("BDD44",()=>{
const m={id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:current()};
ingest([m],()=>{});ingest([{...m,text:"內容已修改"}],()=>{});
assert(state.messages.length===1 && state.messages[0].text===m.text &&
state.messages[0].latestText==="內容已修改","original edit was lost");
});
test("BDD45",()=>{
state.lastSeenId=5020;
ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:current()}],()=>{});
assert(state.orders.length===0 && state.messages[0].classification==="late_history_ignored","backfilled a past order");
});
test("BDD46",()=>{
ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",
publishedAt:new Date(Date.now()+180000).toISOString()}],()=>{});
assert(state.orders.length===0 && state.messages[0].classification==="stale_or_missing_timestamp","future signal accepted");
});
test("BDD47",()=>{
ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:null}],()=>{});
assert(state.orders.length===0 && state.messages[0].classification==="stale_or_missing_timestamp","undated signal accepted");
});
test("BDD48",()=>{
ingest([{id:5001,text:"#SOL 掛單 99-101附近多 止損 95",
publishedAt:new Date(Date.now()-AGE+10000).toISOString()}],()=>{});
assert(state.orders.length===1 && state.orders[0].status==="pending","fresh limit rejected");
});
test("BDD49",()=>{
ingest([{id:5001,replyTo:4999,text:"全部平倉",publishedAt:current()}],()=>{});
assert(state.orders.length===0 && state.messages[0].classification==="orphan_reply_needs_review","orphan close accepted");
});
test("BDD50",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
state.lastSeenId=5001;
ingest([{id:5002,replyTo:5001,text:"減倉",publishedAt:new Date(Date.now()-AGE-1000).toISOString()}],()=>{});
assert(o.pendingCloseCommands.length===0 && o.exitEvents.length===0,"stale close processed");
});
test("BDD51",()=>{
ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:current()},
{id:5002,text:"#SOL 掛單 99-101附近多 止損 95",publishedAt:current()}],()=>{});
assert(state.orders.length===2 && state.orders[0].messageId!==state.orders[1].messageId,"distinct orders collapsed");
});
test("BDD52",()=>{
state=fresh();
ingest([{id:5003,text:"A",publishedAt:current()},{id:5001,text:"B",publishedAt:current()}],()=>{});
assert(state.lastSeenId===5003 && state.messages.length===2 && state.orders.length===0,"baseline watermark wrong");
});
test("BDD53",()=>{
ingest([{id:5005,text:"評論",publishedAt:current()}],()=>{});
assert(state.lastSeenId===5005 && state.messages.length===1,"watermark not advanced");
});
test("BDD54",()=>{
ingest([{id:5001,text:"#XAU 市價 4000-4010附近多 止損 3900",publishedAt:current()}],()=>{});
assert(state.orders.length===0 && state.messages[0].classification==="unsupported_market_XAU","unsupported market order created");
});
test("BDD55",()=>{
ingest([{id:5001,text:"#ZEC 現在不急著追多，可以先觀察",publishedAt:current()}],()=>{});
assert(state.orders.length===0,"vague signal traded");
});
test("BDD56",()=>{
ingest([{id:5001,text:"全部平倉",publishedAt:current(),replyTo:null}],()=>{});
assert(state.orders.length===0 && state.messages[0].classification==="unlinked_exit_needs_review","unlinked exit traded");
});
test("BDD57",()=>{
const o=mock();state.orders=[o];state.lastSeenId=5001;
ingest([{id:5002,text:"取消掛單",publishedAt:current(),replyTo:5001}],()=>{});
assert(o.status==="cancelled","pending cancellation ignored");
});
test("BDD58",()=>{
const o=mock({status:"waiting_price"});state.orders=[o];state.lastSeenId=5001;
ingest([{id:5002,text:"取消掛單",publishedAt:current(),replyTo:5001}],()=>{});
assert(o.status==="cancelled","waiting quote cancellation ignored");
});
test("BDD59",()=>{
const o=mock();state.orders=[o];openOrder(o,100);state.lastSeenId=5001;
ingest([{id:5002,text:"取消掛單",publishedAt:current(),replyTo:5001}],()=>{});
assert(o.status==="open" && o.exitEvents.length===0 &&
state.messages[0].classification==="needs_review","cancelled an already filled order");
});
test("BDD60",()=>{
const o=mock({status:"cancelled"});state.orders=[o];handlePrice("SOLUSDT",100);
assert(o.status==="cancelled" && o.qty===0,"cancelled order reopened");
});


// State machine, order sizing, stop/take-profit and partial close.
test("BDD61",()=>{
const o=mock({status:"expired"});state.orders=[o];handlePrice("SOLUSDT",100);
assert(o.status==="expired" && o.qty===0,"expired order filled");
});
test("BDD62",()=>{
const o=mock({status:"rejected"});state.orders=[o];handlePrice("SOLUSDT",100);
assert(o.status==="rejected" && o.qty===0,"rejected order filled");
});
test("BDD63",()=>{
const o=mock();state.orders=[o];handlePrice("SOLUSDT",100);
const qty=o.qty,entry=o.entryTime;
handlePrice("SOLUSDT",100);handlePrice("SOLUSDT",101);
assert(o.status==="open" && o.qty===qty && o.entryTime===entry,"duplicate entry");
});
test("BDD64",()=>{
const o=mock();state.orders=[o];openOrder(o,100);o.reason="channel_close_requested";
handlePrice("SOLUSDT",100.5);
assert(o.status==="closed" && o.reason==="channel_close","legacy pending close lost");
});
test("BDD65",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
handlePrice("BTCUSDT",94);
assert(o.status==="open" && o.exitEvents.length===0,"other symbol price changed SOL");
});
test("BDD66",()=>{
const o=mock({side:"short",stop:105});state.orders=[o];
handlePrice("SOLUSDT",101);
assert(o.status==="open" && o.qty>0 && o.entryPrice<101,"short entry failed");
});
test("BDD67",()=>{
const o=mock();state.orders=[o];
handlePrice("SOLUSDT",98);assert(o.status==="pending","low outside range filled");
handlePrice("SOLUSDT",102);assert(o.status==="pending","high outside range filled");
});
test("BDD68",()=>{
const o=mock();state.orders=[o];handlePrice("SOLUSDT",99);
assert(o.status==="open","lower boundary rejected");
});
test("BDD69",()=>{
const o=mock();state.orders=[o];handlePrice("SOLUSDT",101);
assert(o.status==="open","upper boundary rejected");
});
test("BDD70",()=>{
for (const price of [NaN,0,-1,Infinity]) {
const o=mock();state.orders=[o];handlePrice("SOLUSDT",price);
assert(o.status==="pending" && !o.qty,"invalid quote filled: "+price);
}
});
test("BDD71",()=>{
const o=mock();state.orders=[o];openOrder(o,0);
assert(o.status==="rejected" && o.qty===0,"zero entry accepted");
});
test("BDD72",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
o.pendingCloseCommands.push({messageId:5002,fraction:0.5,reason:"channel_partial_take_profit"});
handlePrice("SOLUSDT",94);
assert(o.status==="closed" && o.reason==="stop_loss" && o.exitEvents.length===1,"stop was bypassed");
});
test("BDD73",()=>{
const o=mock({target:110});state.orders=[o];openOrder(o,100);
o.pendingCloseCommands.push({messageId:5002,fraction:1,reason:"channel_close"});
handlePrice("SOLUSDT",111);
assert(o.status==="closed" && o.reason==="take_profit" && o.exitEvents.length===1,"double close with TP");
});
test("BDD74",()=>{
const o=mock();state.orders=[o];openOrder(o,100);const initial=o.qty;
o.pendingCloseCommands=[{messageId:5002,fraction:0.5,reason:"partial"},
{messageId:5003,fraction:0.5,reason:"partial"}];
handlePrice("SOLUSDT",100.5);
assert(o.status==="open" && o.exitEvents.length===2,"partial command count wrong");
near(o.qty,initial*0.25);
});
test("BDD75",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"partial",0.5,5002);
const remaining=o.qty;
handlePrice("SOLUSDT",100.5);
near(o.qty,remaining);
assert(o.exitEvents.length===1,"partial exit replayed");
});
test("BDD76",()=>{
const o=mock();state.orders=[o];openOrder(o,100);const q=o.qty;
closeOrder(o,110,"partial",0,5002);
assert(o.status==="open" && o.qty===q && o.exitEvents.length===0,"zero fraction exited");
});
test("BDD77",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"channel_close",2);
assert(o.status==="closed" && o.qty===0 && o.exitEvents.length===1 &&
o.exitEvents[0].qty<=o.initialQty,"overclosed negative quantity");
});
test("BDD78",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"take_profit");const pnl=o.netPnl;
closeOrder(o,200,"take_profit");
assert(o.exitEvents.length===1 && o.netPnl===pnl,"closed position double-settled");
});
test("BDD79",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"take_profit");handlePrice("SOLUSDT",50);
assert(o.status==="closed" && o.exitEvents.length===1,"closed position stopped again");
});
test("BDD80",()=>{
const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
closeOrder(o,90,"take_profit");
assert(o.netPnl>0 && o.grossPnl>0,"profitable short scored as loss");
});
test("BDD81",()=>{
const a=mock({id:"A",messageId:5001}),b=mock({id:"B",messageId:5002});
state.orders=[a,b];openOrder(a,100);openOrder(b,100);
const sum=a.qty*a.entryPrice+b.qty*b.entryPrice;
assert(a.qty*a.entryPrice<=START_BALANCE*MAX_POSITION+0.01 &&
b.qty*b.entryPrice<=START_BALANCE*MAX_POSITION+0.01 &&
sum<=START_BALANCE+0.01,"portfolio allocation exceeded cap");
});
test("BDD82",()=>{
state.orders=[mock({status:"closed",qty:0,initialQty:1,netPnl:-START_BALANCE})];
const o=mock({id:"N",messageId:5002});state.orders.push(o);openOrder(o,100);
assert(o.status==="rejected" && o.qty===0,"opened with zero net worth");
});
test("BDD83",()=>{
assert(closeFraction("減倉150%")===0 && closeFraction("減倉 4/3")===0,
"invalid fraction converted into full close");
});
test("BDD84",()=>{
assert(partialMsg("止盈 30%") && closeMsg("止盈 30%"),"percentage TP not partial");
near(closeFraction("止盈 30%"),0.3);
});
test("BDD85",()=>{
const o=mock();state.orders=[o];openOrder(o,100);closeOrder(o,110,"take_profit");
near(o.entryPrice,100*(1+SLIP));near(o.exitPrice,110*(1-SLIP));
});
test("BDD86",()=>{
const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
closeOrder(o,90,"take_profit");
near(o.entryPrice,100*(1-SLIP));near(o.exitPrice,90*(1+SLIP));
});
test("BDD87",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
near(o.feeEntry,o.qty*o.entryPrice*FEE);
});
test("BDD88",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"partial",0.5,5002);closeOrder(o,115,"full");
near(o.feeExit,o.exitEvents.reduce((v,x)=>v+x.feeExit,0));
});
test("BDD89",()=>{
const o=mock();state.orders=[o];openOrder(o,100);closeOrder(o,110,"partial",0.5,5002);
const before=realizedOf(o);
handlePrice("SOLUSDT",100.5);
near(realizedOf(o),before);
});
test("BDD90",()=>{
const o=mock();state.orders=[o];openOrder(o,100);const before=o.qty;
closeOrder(o,0,"take_profit");
closeOrder(o,NaN,"take_profit");
assert(o.status==="open" && o.qty===before && o.exitEvents.length===0,"bad close quote accepted");
});


// Portfolio accounting, audit, reports, security & recovery behaviour.
test("BDD91",()=>{
const r=report();near(r.equity,START_BALANCE);
assert(r.closedTrades===0 && r.openPositions===0 && r.pendingOrders===0 &&
r.realizedPnl===0 && r.unrealizedPnl===0,"empty portfolio report wrong");
});
test("BDD92",()=>{
const o=mock();state.orders=[o];openOrder(o,100);closeOrder(o,110,"take_profit");
const r=report();assert(r.closedTrades===1 && r.winRatePct===100 && r.realizedPnl>0,"win rate wrong");
});
test("BDD93",()=>{
const t=current();
state.orders=[
mock({id:"A",status:"closed",netPnl:10,exitTime:t,exitEvents:[{at:t,netPnl:10}]}),
mock({id:"B",status:"closed",netPnl:-5,exitTime:t,exitEvents:[{at:t,netPnl:-5}]})
];
const r=report();assert(r.closedTrades===2 && r.winRatePct===50,"two trades win rate wrong");
});
test("BDD94",()=>{
const t=current();
state.orders=[mock({status:"closed",netPnl:10,exitTime:t,exitEvents:[
{at:t,netPnl:20},{at:t,netPnl:-10}
]})];
near(report().profitFactor,2);
});
test("BDD95",()=>{
const o=mock();state.orders=[o];openOrder(o,100);closeOrder(o,110,"take_profit");
assert(report().profitFactor===null,"profit factor should be null without losses");
});
test("BDD96",()=>{
state.snapshots=[{at:current(),equity:10000},{at:current(),equity:11000},
{at:current(),equity:9000}];
near(report().maxDrawdownPct,2000/11000*100);
});
test("BDD97",()=>{
snapshot();snapshot();snapshot();
assert(state.snapshots.length===1,"snapshot interval missing");
});
test("BDD98",()=>{
const at1="2026-11-02T23:59:00Z",at2="2026-11-03T00:01:00Z";
state.orders=[mock({status:"closed",netPnl:15,exitEvents:[
{at:at1,netPnl:10},{at:at2,netPnl:5}
]})];
const r=report();
assert(r.daily["2026-11-02"].trades===1 && r.daily["2026-11-03"].trades===1,"UTC day split missing");
});
test("BDD99",()=>{
state.orders=[mock({status:"closed",netPnl:30,exitEvents:[
{at:"2026-10-31T23:59:00Z",netPnl:10},{at:"2026-11-01T00:01:00Z",netPnl:20}
]})];
const r=report();
assert(r.monthly["2026-10"].pnl===10 && r.monthly["2026-11"].pnl===20,"month boundary wrong");
});
test("BDD100",()=>{
const t=current();
state.orders=[
mock({id:"A",symbol:"SOLUSDT",status:"closed",netPnl:8,exitEvents:[{at:t,netPnl:8}]}),
mock({id:"B",symbol:"BTCUSDT",status:"closed",netPnl:-3,exitEvents:[{at:t,netPnl:-3}]})
];
const r=report();
assert(r.symbols.SOLUSDT.pnl===8 && r.symbols.BTCUSDT.pnl===-3,"symbols merged");
});
test("BDD101",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"partial",0.5,5002);
closeOrder(o,105,"full");
near(report().feesPaid,o.feeEntry+o.feeExit);
});
test("BDD102",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"partial",0.5,5002);
assert(o.status==="open" && report().realizedPnl>0 && report().partialExits===1,
"partial revenue missing");
});
test("BDD103",()=>{
const a=mock({id:"A",messageId:5001}),b=mock({id:"B",messageId:5002});
state.orders=[a,b];openOrder(a,100);closeOrder(a,110,"take_profit");
openOrder(b,100);handlePrice("SOLUSDT",105);
const r=report();
near(r.equity,START_BALANCE+r.realizedPnl+r.unrealizedPnl);
});
test("BDD104",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"partial",0.5,5002);
closeOrder(o,115,"full",1,5003);
assert(o.status==="closed" && o.exitEvents.length===2 &&
o.exitEvents[0].messageId===5002 && o.exitEvents[1].messageId===5003,"exit audit trail lost");
});
test("BDD105",()=>{
state.orders=[mock(),mock({id:"B",messageId:5002,status:"waiting_price"})];
assert(equity()===START_BALANCE && report().realizedPnl===0,"unfilled order affected equity");
});
test("BDD106",()=>{
state.orders=[mock({status:"cancelled"})];
assert(report().feesPaid===0 && report().realizedPnl===0,"cancelled order charged fee");
});
test("BDD107",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"take_profit");const before=o.netPnl;
handlePrice("SOLUSDT",80);
near(o.netPnl,before);near(equity(),START_BALANCE+before);
});
test("BDD108",()=>{
const content=csv();
assert(content.startsWith("messageId,symbol,side,kind,status") &&
content.includes("netPnl") && content.includes("exitEvents"),"CSV fields incomplete");
});
test("BDD109",()=>{
state.orders=[mock({reason:'alert "incorrect" text'})];
const content=csv();
assert(content.includes('""incorrect""') && content.split("\n").length===2,"CSV quote escape failed");
});
test("BDD110",()=>{
state.orders=[mock()];
assert(csv().includes("https://t.me/KCryptoBTC168/5001"),"original channel link missing");
});
test("BDD111",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"partial",0.5,5002);
assert(csv().includes("fractionOfRemaining") && csv().includes("5002"),"partial exits missing from export");
});
test("BDD112",()=>{
const r=route(new Request("http://localhost/healthz"));
assert(r.status===200 && r.headers.get("Cache-Control")==="no-store","health endpoint not healthy");
});
test("BDD113",()=>{
for(const path of ["/","/api/report","/api/orders","/api/orders.csv","/api/status","/api/telegram/status"])
assert(route(new Request("http://localhost"+path)).status===200,"public report inaccessible: "+path);
for(const path of ["/api/selftest","/api/telegram/setup","/api/messages","/api/quotes"])
assert(route(new Request("http://localhost"+path)).status===401,"protected route exposed: "+path);
});
test("BDD114",()=>{
const r=route(new Request("http://localhost/api/messages",{headers:{Authorization:"Basic invalidbase64%%%"} }));
assert(r.status===401,"malformed Basic was accepted");
});
test("BDD115",()=>{
const h="Basic "+btoa("viewer:not-the-secret");
assert(route(new Request("http://localhost/api/telegram/setup",{headers:{Authorization:h}})).status===401,
"wrong password allowed");
});
test("BDD116",()=>{
const h="Basic "+btoa("viewer:"+password);
assert(route(new Request("http://localhost/api/messages",{headers:{Authorization:h}})).status===200,
"authenticated management data inaccessible");
});
test("BDD117",()=>{
assert(route(new Request("http://localhost/api/report",{method:"POST"})).status===405,
"POST accepted on read-only API");
});
test("BDD118",()=>{
const h="Basic "+btoa("viewer:"+password);
assert(route(new Request("http://localhost/api/unknown",{headers:{Authorization:h}})).status===404,
"unknown API route did not 404");
});
test("BDD119",()=>{
const r=route(new Request("http://localhost/api/report"));
assert(r.status===200 && (r.headers.get("Content-Type")||"").includes("application/json"),
"report content type wrong");
});
test("BDD120",()=>{
const r=route(new Request("http://localhost/api/orders.csv"));
assert(r.status===200 && (r.headers.get("Content-Type")||"").includes("text/csv") &&
(r.headers.get("Content-Disposition")||"").includes("filename="),"CSV download headers missing");
});
test("BDD121",()=>{
assert(route(new Request("http://localhost/api/selftest?debug=1")).status===401,
"selftest auth bypass");
});
test("BDD122",()=>{
const h="Basic "+btoa("viewer:"+password);
const r=route(new Request("http://localhost/api/report",{headers:{Authorization:h}}));
assert(r.headers.get("Cache-Control")==="no-store","sensitive report cached");
});
test("BDD123",()=>{
handlePrice("SOLUSDT",123.456);
assert(state.quotes.SOLUSDT?.price===123.456 &&
!isNaN(Date.parse(state.quotes.SOLUSDT?.at)), "quote timestamp missing");
});
test("BDD124",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,110,"partial",0.5,5002,true);
const saved=JSON.stringify(state);
const restored=JSON.parse(saved),x=restored.orders[0];
assert(x.status==="open" && x.exitEvents.length===1 && x.exitEvents[0].messageId===5002 &&
x.qty>0 && x.qty<x.initialQty,"partial order lost on restart");
});
test("BDD125",()=>{
let writes=0;
ingest([{id:5001,text:"#SOL 掛單 99-101附近多 止損 95",publishedAt:current()}],
()=>{ writes++; });
assert(writes===1 && state.orders.length===1,"mock persistence callback not applied");
});


test("BDD126",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
const threshold=onePctNetTargetMark(o);
assert(threshold>o.entryPrice*1.01,"long net threshold must cover fees");
const delta=projectedNetReturn(o,threshold);
near(delta,0.01,1e-10);
});
test("BDD127",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",o.entryPrice*1.01);
assert(o.status==="open" && projectedNetReturn(o,o.entryPrice*1.01)<0.01,
"closed on gross 1 percent without fees");
});
test("BDD128",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
const mark=onePctNetTargetMark(o)*1.00001;
handlePrice("SOLUSDT",mark);
assert(o.status==="closed" && o.reason==="net_take_profit_1pct" && o.qty===0,
"long net TP not closed");
assert(o.netPnl>=o.initialQty*o.entryPrice*NET_TAKE_PROFIT,
"long realized net gain below 1 percent");
});
test("BDD129",()=>{
const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
const mark=onePctNetTargetMark(o)*0.99999;
assert(mark<o.entryPrice*0.99,"short target should account for costs");
handlePrice("SOLUSDT",mark);
assert(o.status==="closed" && o.reason==="net_take_profit_1pct" &&
o.netPnl>=o.initialQty*o.entryPrice*NET_TAKE_PROFIT,
"short net TP missed");
});
test("BDD130",()=>{
const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",o.entryPrice*0.99);
assert(o.status==="open" && projectedNetReturn(o,o.entryPrice*0.99)<0.01,
"short gross 1 percent closed early");
});
test("BDD131",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",94);
assert(o.status==="closed" && o.reason==="stop_loss" && o.netPnl<0,"stop ignored");
});
test("BDD132",()=>{
const o=mock({target:100.5});state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",100.5);
assert(o.status==="open","explicit TP below 1 percent closed");
handlePrice("SOLUSDT",onePctNetTargetMark(o)*1.00001);
assert(o.status==="closed" && o.netPnl>=o.initialQty*o.entryPrice*NET_TAKE_PROFIT,
"net TP after lower target failed");
});
test("BDD133",()=>{
const o=mock({target:150});state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",onePctNetTargetMark(o)*1.00001);
assert(o.status==="closed" && o.reason==="net_take_profit_1pct" &&
o.exitPrice<150,"high channel target prevented 1 percent TP");
});
test("BDD134",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,101,"channel_partial_take_profit",0.5,5002,true);
assert(o.status==="open" && o.qty>0,"partial exit should remain open");
const remaining=o.qty, projected=onePctNetTargetMark(o)*1.00001;
handlePrice("SOLUSDT",projected);
assert(o.status==="closed" && o.exitEvents.length===2 &&
o.exitEvents[1].qty===remaining &&
o.exitEvents[1].netPnl>=remaining*o.entryPrice*NET_TAKE_PROFIT,"remaining net TP wrong");
});
test("BDD135",()=>{
const o=mock();state.orders=[o];
assert(projectedNetReturn(o,101)===null && onePctNetTargetMark(o)===null,"unopened order has net TP");
});
test("BDD136",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
for(const px of [0,-1,NaN,Infinity]){
assert(projectedNetReturn(o,px)===null,"invalid net TP projection "+px);
handlePrice("SOLUSDT",px);
}
assert(o.status==="open","invalid quote triggered close");
});
test("BDD137",()=>{
const o=mock();state.orders=[o];openOrder(o,100);
const mark=onePctNetTargetMark(o)*1.00001;
handlePrice("SOLUSDT",mark);
const pnl=o.netPnl;
handlePrice("SOLUSDT",mark*2);
assert(o.status==="closed" && o.exitEvents.length===1 && o.netPnl===pnl,
"auto net TP double settled");
});


test("BDD138",()=>{
state.orders=[mock({id:"A",messageId:5501})];
queueNotice("test:unpaired","must not send");
assert((state.notifications||[]).length===0,"unpaired target queued a message");
});
test("BDD139",()=>{
state.telegram.chatId="123456789";
ingest([{id:5001,text:"#SOL 掛單 99-101附近多 止損 95",publishedAt:current()}],()=>{});
assert(state.notifications.length===1 && state.notifications[0].key==="signal:5001","new signal notice missing");
});
test("BDD140",()=>{
state.telegram.chatId="123456789";
const msg={id:5001,text:"#SOL 掛單 99-101附近多 止損 95",publishedAt:current()};
ingest([msg],()=>{});ingest([msg],()=>{});
assert(state.notifications.length===1,"duplicate signal alert");
});
test("BDD141",()=>{
state.telegram.chatId="123456789";const o=mock();state.orders=[o];
handlePrice("SOLUSDT",100);
assert(o.status==="open" && state.notifications.some(n=>n.key==="open:5001" && n.text.includes("成交價")),"entry alert missing");
});
test("BDD142",()=>{
state.telegram.chatId="123456789";const o=mock();state.orders=[o];openOrder(o,100);
handlePrice("SOLUSDT",94);
assert(state.notifications.some(n=>n.key==="exit:5001:1" && n.text.includes("已實現淨損益") && n.text.includes("模擬止損")),"stop alert missing");
});
test("BDD143",()=>{
state.telegram.chatId="123456789";const o=mock();state.orders=[o];openOrder(o,100);
const x=onePctNetTargetMark(o)*1.00001;
handlePrice("SOLUSDT",x);handlePrice("SOLUSDT",x*1.01);
assert(state.notifications.filter(n=>n.key==="exit:5001:1").length===1 &&
state.notifications.some(n=>n.text.includes("淨利 1% 自動止盈")),"net TP notification duplicate/missing");
});
test("BDD144",()=>{
state.telegram.chatId="123456789";const o=mock();state.orders=[o];openOrder(o,100);
closeOrder(o,100.5,"channel_partial_take_profit",0.5,5002,true);
closeOrder(o,110,"net_take_profit_1pct");
assert(state.notifications.filter(n=>n.key.startsWith("exit:5001:")).length===2 &&
state.notifications.some(n=>n.key==="exit:5001:2"),"partial/full exit event identity wrong");
});
test("BDD145",()=>{
state.telegram.chatId="123456789";const o=mock({status:"pending"});state.orders=[o];
for(let n=0;n<10;n++)handlePrice("SOLUSDT",120);
assert(state.notifications.length===0,"quote tick spammed Telegram");
});
test("BDD146",()=>{
state.telegram.pairingCode="0123456789abcdef0123456789abcdef";
assert(!pairingMatches({from:{username:"someoneelse"},chat:{type:"private"},text:"/start "+state.telegram.pairingCode},state.telegram),
"wrong username paired");
});
test("BDD147",()=>{
state.telegram.pairingCode="0123456789abcdef0123456789abcdef";
assert(pairingMatches({from:{username:TG_TARGET},chat:{type:"private"},text:"/start "+state.telegram.pairingCode},state.telegram),
"valid pairing failed");
assert(!pairingMatches({from:{username:TG_TARGET},chat:{type:"group"},text:"/start "+state.telegram.pairingCode},state.telegram),
"group chat paired");
});
test("BDD148",()=>{
const publicStatus=publicTelegramStatus();
assert(route(new Request("http://localhost/api/telegram/status")).status===200 &&
route(new Request("http://localhost/api/telegram/setup")).status===401 &&
!["pairingCode","startUrl","chatId","lastError","botTokenConfigured","pairedAt"].some(k=>k in publicStatus),
"public Telegram summary or protected setup boundary invalid");
});
test("BDD149",()=>{
state.telegram.chatId="123456789";
queueNotice("exit:5001:1","test persistence");
const restored=JSON.parse(JSON.stringify(state));
assert(restored.notifications.length===1 && restored.notifications[0].key==="exit:5001:1","outbox not persistent");
});

test("BDD150",()=>{
const t=tgState();
t.chatId="123456"; t.error="sendMessage HTTP 503";t.pollError="getUpdates timeout";
state.notifications=[];
confirmInboundTelegramHealthy(t);
assert(t.pollError===null && t.error==="sendMessage HTTP 503" &&
state.notifications.length===0,"inbound check cleared outbound failure or emitted false recovery");
});

test("BDD151",()=>{
state.telegram.chatId="123456";
const fake = mock({ messageId:undefined, id:"BOOT_TEST" });
state.orders=[fake];
openOrder(fake,100);
closeOrder(fake,110,"take_profit");
assert(state.notifications.length===0,"synthetic startup trade leaked into Telegram outbox");
});


test("BDD152",()=>{
state.telegram.chatId="123456";
const old=notificationsMutedForStartupTests;
try {
notificationsMutedForStartupTests=true;
const fake=mock({messageId:5001});
state.orders=[fake];
openOrder(fake,100);
closeOrder(fake,110,"take_profit");
assert(state.notifications.length===0,"startup test leaked Telegram notification");
} finally { notificationsMutedForStartupTests=old; }
});

test("BDD153",()=>{
state.orders=[mock({status:"closed",netPnl:5})];
const paper={equity:10005,netReturnPct:.05,realizedPnl:5,closedTrades:1};
const remote={schemaVersion:1,ledger:"BINANCE_DEMO_DONCHIAN",performance:{closedTrades:2,wins:1,netPnlUsdt:-1}};
const x=mergeDonchianStats(paper,remote,{error:null});
assert(x.equity===10005&&x.netReturnPct===.05&&x.realizedPnl===5&&x.donchianDemo.performance.netPnlUsdt===-1&&!('combined' in x),"ledger separation failed");
});
test("BDD154",()=>{
const x=mergeDonchianStats({realizedPnl:0,closedTrades:0},{schemaVersion:99},{error:"schema"});
assert(!x.donchianDemo.available&&page.includes("1H Donchian + EMA200 + ATR Paper 帳本")&&page.includes("Demo 下單停用"),"invalid integration state");
});
test("BDD155",()=>{const remote={schemaVersion:1,ledger:"BINANCE_DEMO_DONCHIAN",performance:{},paper:{openPositions:1,equity:9999},advisoryPositions:[{symbol:"SOLUSDT",status:"PAPER_OPEN"}]};
const x=mergeDonchianStats({realizedPnl:0,closedTrades:0},remote,{error:null});assert(x.donchianDemo.paper.openPositions===1&&page.includes("Donchian Paper 模擬持倉明細"),"paper detail missing");});
test("BDD156",()=>{assert(page.includes("Telegram 訊號 Paper 帳本")&&page.includes("Telegram Paper 淨值")&&page.includes("1H Donchian + EMA200 + ATR Paper 帳本")&&page.includes("Donchian Paper 淨值")&&!page.includes("跨帳本合計"),"Paper ledgers are not visually separated");});
test("BDD157",()=>{const remote={schemaVersion:1,ledger:"BINANCE_DEMO_DONCHIAN",performance:{},paper:{closedTrades:1},closedPaperPositions:[{symbol:"BTCUSDT",status:"PAPER_CLOSED",netPnl:2}]};const x=mergeDonchianStats({},remote,{error:null});assert(x.donchianDemo.closedPositions.length===1&&page.includes("Donchian Paper 平倉紀錄")&&page.includes("dClosedPositions"),"closed Paper history missing");});
test("BDD158",()=>{assert(page.includes("即時標記價")&&page.includes("行情時間")&&!page.includes("<th>現價</th>"),"mark price label missing");});
test("BDD159",()=>{assert(page.includes("1H Donchian + EMA200 + ATR")&&page.includes("新建倉策略")&&page.includes("Legacy 15m"),"strategy replacement not labelled");});
test("BDD160",()=>{assert(page.includes("Telegram Paper 模擬交易紀錄")&&page.includes("<th>K線</th>")&&page.includes("telegramChartUrl")&&page.includes("15m K線"),"Telegram Paper chart link missing");});
test("BDD161",()=>{assert(page.includes("TELEGRAM_TRADE_PAGE_SIZE=10")&&page.includes("tradesPrev")&&page.includes("tradesNext")&&page.includes("每頁 10 筆")&&page.includes("renderTelegramTrades"),"Telegram Paper pagination missing");});
test("BDD162",()=>{assert(page.includes("responsive-table")&&page.includes("data-label")&&page.includes("grid-template-columns:1fr")&&page.includes("viewport"),"mobile RWD layout missing");});
test("BDD163",()=>{const publicPaths=["/","/api/status","/api/report","/api/orders","/api/orders.csv","/api/telegram/status"];assert(publicPaths.every(path=>route(new Request("http://localhost"+path)).status===200)&&route(new Request("http://localhost/api/telegram/setup")).status===401,"public/protected route boundary invalid");});
test("BDD164",()=>{
state.orders=[mock({entryPrice:101,exitPrice:102,netPnl:1.5,
pendingCloseCommands:[{text:"PRIVATE_COMMAND"}],internalKey:"PRIVATE_KEY",debugToken:"PRIVATE_TOKEN"})];
const publicRows=publicOrders(),row=publicRows[0];
assert(publicRows.length===1&&row.messageId===5001&&row.symbol==="SOLUSDT"&&
row.entryPrice===101&&row.exitPrice===102&&row.netPnl===1.5&&
Object.keys(row).sort().join(",")==="entryHigh,entryLow,entryPrice,exitPrice,messageId,netPnl,side,status,symbol"&&
!JSON.stringify(publicRows).includes("PRIVATE_")&&
!JSON.stringify(publicRows).includes("pendingCloseCommands"),
"public orders returned internal Paper state");
});
test("BDD165",()=>{
state.channelError="Authorization: Bearer PRIVATE_CHANNEL_TOKEN";
state.priceError="https://internal.example/?token=PRIVATE_PRICE_TOKEN";
const status=publicPaperStatus();
assert(status.channelError==="Telegram 頻道資料暫時無法取得"&&
status.priceError==="行情資料暫時無法取得"&&
!JSON.stringify(status).includes("PRIVATE_")&&
status.mode==="PAPER_ONLY"&&status.ordersTracked===0,
"public status leaked upstream error details");
});
test("BDD166",()=>{
state.orders=[mock({messageId:"<script>",symbol:"BTCUSDT<script>",side:"invalid",status:"<script>",entryLow:NaN,entryHigh:Infinity,entryPrice:Infinity,netPnl:NaN})];
const row=publicOrders()[0];
assert(row.messageId===null&&row.symbol===null&&row.side===null&&
row.status==="unknown"&&row.entryLow===null&&row.entryHigh===null&&row.entryPrice===null&&row.netPnl===null,
"invalid internal values flowed into public trade rows");
});
test("BDD167",()=>{
state.orders=Array.from({length:105},(_,i)=>mock({messageId:5001+i}));
const rows=publicOrders();
assert(rows.length===100&&rows[0].messageId===5006&&rows[99].messageId===5105,
"public orders ignored 100-row API window");
});

test("BDD168",()=>{
state.orders=[mock({reason:'=HYPERLINK("https://bad.example","click")'})];
assert(csv().includes('"\'=HYPERLINK(""https://bad.example"",""click"")"'),
"spreadsheet formula was not neutralized in CSV");
});
test("BDD169",()=>{
for(const suspicious of ["+SUM(A1)","-HYPERLINK(A1)","@SUM(A1)"," \t=1+1","\ufeff=1+1"]){
const cell=csvCell(suspicious);
assert(cell.startsWith('"\'')&&!cell.includes("\r")&&!cell.includes("\n"),"CSV leading formula marker not escaped");
}
assert(csvCell(-7.5)==='"-7.5"',"finite negative PnL lost numeric representation");
});
test("BDD170",()=>{
state.orders=[mock({reason:"first\nsecond\rthird"})];
const content=csv();
assert(content.split("\n").length===2&&content.includes("first second third"),
"CSV untrusted line breaks created extra records");
});
test("BDD171",()=>{
state.orders=[mock({messageId:"=1+1",reason:'note "unchanged"'})];
const content=csv();
assert(!content.includes("https://t.me/KCryptoBTC168/=")&&
content.includes('"","SOLUSDT"')&&content.includes('"note ""unchanged"""'),
"CSV original link input was unsafely constructed");
});

test("BDD172",()=>{
state.orders=[mock({entryLow:99.5,entryHigh:101.75,pendingCloseCommands:[{text:"PRIVATE"}]})];
const row=publicOrders()[0];
assert(row.entryLow===99.5&&row.entryHigh===101.75&&
Object.keys(row).sort().join(",")==="entryHigh,entryLow,entryPrice,exitPrice,messageId,netPnl,side,status,symbol"&&
!JSON.stringify(row).includes("PRIVATE"),"public API no longer matches entry-range UI or leaks internal state");
});
test("BDD173",()=>{
state.orders=[mock({entryLow:NaN,entryHigh:Infinity})];
const row=publicOrders()[0];
assert(row.entryLow===null&&row.entryHigh===null&&page.includes("priceRange(x)")&&
page.includes("Number.isFinite(x.entryLow)&&Number.isFinite(x.entryHigh)"),
"invalid range or missing-value UI fallback regression");
});


// Isolated inline-renderer BDD: execute only table functions, never timers/network.
function renderTradeRowForBDD(row) {
const begin=page.indexOf("<script>"),finish=page.indexOf("</script>",begin);
assert(begin>=0&&finish>begin,"dashboard script unavailable");
const inline=page.slice(begin+8,finish);
const start=inline.indexOf("const telegramChartUrl="),
end=inline.indexOf("function moveTelegramTradePage(",start);
assert(start>=0&&end>start,"Telegram render function unavailable");
const fragment=inline.slice(start,end);
const run=new Function("row","fmt","clean","pnl",
"const nodes={};const $=id=>nodes[id]||(nodes[id]={innerHTML:'',textContent:'',disabled:false});"+
fragment+
"\ntelegramTradeRows=[row];renderTelegramTrades();return nodes.trades.innerHTML;");
return run(row,(n,d=2)=>Number(n||0).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}),
s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),
n=>String(n));
}
test("BDD174",()=>{
state.orders=[mock({messageId:"invalid-id",symbol:"BTC<script>",entryLow:NaN,entryHigh:Infinity})];
const html=renderTradeRowForBDD(publicOrders()[0]);
assert(!html.includes("href=")&&!html.includes("#null")&&
!html.includes("BINANCE%3A.P")&&html.includes("來源訊號不可用")&&
html.includes("行情連結不可用"),"invalid trade identifiers generated clickable or deceptive links");
});
test("BDD175",()=>{
state.orders=[mock({messageId:5001,symbol:"BTCUSDT",entryLow:99.5,entryHigh:101.75})];
const html=renderTradeRowForBDD(publicOrders()[0]);
assert(html.includes("https://t.me/KCryptoBTC168/5001")&&
html.includes("BINANCE%3ABTCUSDT.P")&&
html.includes("99.50 – 101.75")&&
html.includes('rel="noopener noreferrer"')&&
!html.includes("#null"),"valid Telegram/TradingView links or price range regressed");
});

// Test the actual embedded browser helper with hostile and legitimate upstream URLs.
function donchianChartForBDD(chartUrl){
const begin=page.indexOf("<script>"),finish=page.indexOf("</script>",begin);
const inline=page.slice(begin+8,finish);
const start=inline.indexOf("const donchianChartCell="),end=inline.indexOf("const TELEGRAM_TRADE_PAGE_SIZE",start);
assert(start>=0&&end>start,"Donchian chart renderer missing");
return new Function("x",inline.slice(start,end)+"return donchianChartCell(x);")({chartUrl});
}
test("BDD176",()=>{
for(const bad of ["javascript:alert(1)","data:text/html,<script>alert(1)</script>",
"https://evil.example/chart/?symbol=BINANCE%3ABTCUSDT.P&interval=60",
"https://www.tradingview.com/other/?symbol=BINANCE%3ABTCUSDT.P&interval=60",
"https://www.tradingview.com/chart/?symbol=BINANCE%3A.P&interval=60",
"https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT.P&interval=1",
"https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT.P&interval=60&redirect=javascript:alert(1)"]){
const html=donchianChartForBDD(bad);
assert(!html.includes("<a ")&&!html.includes("href=")&&html.includes("行情連結不可用"),"untrusted Donchian chart URL generated a clickable link");
}
});
test("BDD177",()=>{
for(const [interval,label] of [["15","15m"],["60","1h"]]){
const html=donchianChartForBDD("https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT.P&interval="+interval);
assert(html.includes("BINANCE%3ABTCUSDT.P&interval="+interval)&&html.includes(label+" K線")&&
html.includes('rel="noopener noreferrer"')&&!html.includes("javascript:"),"valid Donchian chart navigation regressed");
}
});

test("BDD178",()=>{
const err="https://internal.invalid/?token=PRIVATE_DONCHIAN_TOKEN; Authorization: Bearer PRIVATE_ACCESS_KEY";
const upstream={ledger:"BINANCE_DEMO_DONCHIAN",schemaVersion:1,performance:{closedTrades:0}};
const result=mergeDonchianStats({},upstream,{error:err});
assert(result.donchianDemo.available&&result.donchianDemo.error==="Donchian 統計服務暫時無法取得"&&
!JSON.stringify(result).includes("PRIVATE_")&&!JSON.stringify(result).includes("Authorization"),
"public Donchian report leaked raw upstream error");
});
test("BDD179",()=>{
const missing=mergeDonchianStats({},{schemaVersion:99},{error:"統計整合未設定"});
const healthy=mergeDonchianStats({}, {ledger:"BINANCE_DEMO_DONCHIAN",schemaVersion:1,performance:{}},{error:null});
assert(!missing.donchianDemo.available&&missing.donchianDemo.error==="統計整合未設定"&&
healthy.donchianDemo.available&&healthy.donchianDemo.error===null,
"public Donchian missing/healthy status regressed");
});


test("BDD180",()=>{
const secret="PRIVATE_UPSTREAM_ACCOUNT_KEY";
const remote={ledger:"BINANCE_DEMO_DONCHIAN",schemaVersion:1,
signals:{total:4,entries:2,exits:2,last:{rawToken:secret}},
performance:{closedTrades:2,netPnlUsdt:-3.2,apiKey:secret},
paper:{equity:9996.8,openPositions:1,credentials:secret},
advisoryPositions:[{symbol:"SOLUSDT",side:"LONG",entryPrice:101,entryTime:"2026-11-07T12:00:00.000Z",
chartUrl:"https://www.tradingview.com/chart/?symbol=BINANCE%3ASOLUSDT.P&interval=60",
paperPnl:-1.2,rawToken:secret}],
closedPaperPositions:[{symbol:"BTCUSDT",side:"SHORT",netPnl:2,exitReason:"TAKE_PROFIT_2R",
exitTime:"2026-11-07T12:00:00.000Z",chartUrl:"javascript:alert(1)",credentials:secret}]};
const result=mergeDonchianStats({equity:10005},remote,{error:"Authorization: "+secret});
assert(result.equity===10005&&result.donchianDemo.signals.total===4&&
result.donchianDemo.performance.netPnlUsdt===-3.2&&
result.donchianDemo.paper.equity===9996.8&&
result.donchianDemo.positions[0].entryPrice===101&&
result.donchianDemo.positions[0].chartUrl===remote.advisoryPositions[0].chartUrl&&
result.donchianDemo.closedPositions[0].netPnl===2&&
!JSON.stringify(result).includes(secret)&&
!JSON.stringify(result).includes("javascript:"),
"public Donchian nested objects leaked private upstream fields or broke legitimate metrics");
});
test("BDD181",()=>{
const remote={ledger:"BINANCE_DEMO_DONCHIAN",schemaVersion:1,
advisoryPositions:[{symbol:"BAD<script>",secret:"PRIVATE_ROW"}],
closedPaperPositions:Array.from({length:150},(_,i)=>({symbol:"BTCUSDT",netPnl:i,
chartUrl:"https://evil.example/chart/?symbol=BINANCE%3ABTCUSDT.P&interval=60",
apiKey:"PRIVATE_ROW"}))};
const result=mergeDonchianStats({},remote,{error:null});
assert(result.donchianDemo.positions.length===0&&
result.donchianDemo.closedPositions.length===100&&
result.donchianDemo.closedPositions[0].chartUrl===null&&
Object.keys(result.donchianDemo.closedPositions[0]).every(k=>k!=="apiKey")&&
!JSON.stringify(result).includes("PRIVATE_ROW"),
"Donchian anonymous detail projection accepted bad symbols, unsafe URL or unbounded rows");
});

// Nullable upstream metrics must not be presented as a zero price or zero balance.
function observedDonchianMetricForBDD(value) {
const inline=page.slice(page.indexOf("<script>")+8,page.indexOf("</script>"));
const start=inline.indexOf("const fmt="),end=inline.indexOf("const clean=",start);
assert(start>=0&&end>start,"Donchian number formatters missing");
return new Function("value",inline.slice(start,end)+
"return {price:fmtObserved(value),pnl:pnlObserved(value),count:countObserved(value)};")(value);
}
test("BDD182",()=>{
const missing=observedDonchianMetricForBDD(null);
const undefinedValue=observedDonchianMetricForBDD(undefined);
assert(missing.price==="—"&&missing.count==="—"&&missing.pnl==="—"&&
undefinedValue.price==="—"&&
page.includes("fmtObserved(x.lastPrice)")&&page.includes("fmtObserved(x.stopLoss)")&&
page.includes("pnlObserved(x.paperPnl)")&&page.includes("fmtObserved(x.fees)")&&
page.includes("validMetric(pp.equity)"),"missing Donchian metrics disguised as numeric zero");
});
test("BDD183",()=>{
const zero=observedDonchianMetricForBDD(0);
const gain=observedDonchianMetricForBDD(12.25);
assert(zero.price==="0.00"&&zero.count==="0"&&zero.pnl.includes("+0.00")&&
gain.price==="12.25"&&gain.pnl.includes("+12.25")&&
!page.includes("pnl(x.netPnl||0)")&&!page.includes("fmt(x.lastPrice)"),
"legitimate numeric zero or valid Donchian metrics display regressed");
});

test("BDD184",()=>{
const remote={ledger:"BINANCE_DEMO_DONCHIAN",schemaVersion:1,signals:{total:2}};
const x=mergeDonchianStats({},remote,{error:"Authorization: PRIVATE_STALE_TOKEN",lastSuccessAt:new Date().toISOString()}).donchianDemo;
assert(x.available&&x.stale&&x.signals.total===2&&x.error==="Donchian 統計服務暫時無法取得"&&
!JSON.stringify(x).includes("PRIVATE_STALE_TOKEN"),"cached report silently looked fresh or exposed raw failure");
});
test("BDD185",()=>{
const remote={ledger:"BINANCE_DEMO_DONCHIAN",schemaVersion:1,signals:{total:0}};
const fresh=mergeDonchianStats({},remote,{error:null,lastSuccessAt:new Date().toISOString()}).donchianDemo;
const old=mergeDonchianStats({},remote,{error:null,lastSuccessAt:new Date(Date.now()-120000).toISOString()}).donchianDemo;
const missing=mergeDonchianStats({},remote,{error:null,lastSuccessAt:null}).donchianDemo;
assert(!fresh.stale&&old.stale&&missing.stale&&fresh.signals.total===0&&
page.includes("d.stale")&&page.includes("d.lastSuccessAt")&&page.includes("不能視為即時行情"),
"upstream cache freshness and UI warning contract failed");
});

test("BDD186",()=>{
state.orders=[mock({exitEvents:[{at:"2026-11-07T00:00:00Z",price:102,qty:0.5,
fractionOfRemaining:0.5,netPnl:1.23,messageId:5002,reason:"channel_partial_take_profit",
internalToken:"SECRET_CSV_186",debugPayload:{password:"SECRET_CSV_186"}}]})];
const content=csv();
assert(!content.includes("SECRET_CSV_186")&&!content.includes("debugPayload")&&
content.includes("fractionOfRemaining")&&content.includes("5002")&&
content.includes("channel_partial_take_profit"),
"public CSV exposed unexpected nested fields or lost partial-close accounting");
});
test("BDD187",()=>{
const projected=JSON.parse(publicCsvExitEvents([
{at:"2026-11-07T00:00:00Z",reason:"stop_loss",price:101.25,netPnl:-2.5,
messageId:5002,assumedRatio:true,unknown:"SECRET_CSV_187"},
{reason:"x",price:"INVALID_PRICE",netPnl:Infinity,messageId:"=1+1",internalSecret:"SECRET_CSV_187"},
null,"INVALID_EVENT"
]));
assert(projected.length===2 && projected[0].netPnl===-2.5 &&
projected[0].messageId===5002 && projected[0].assumedRatio===true &&
!Object.hasOwn(projected[1],"price")&&!Object.hasOwn(projected[1],"messageId")&&
!JSON.stringify(projected).includes("SECRET_CSV_187")&&
publicCsvExitEvents({secret:"SECRET_CSV_187"})==="[]",
"CSV event projection accepted malformed event fields or non-arrays");
});

const failed=results.filter(x=>!x.pass);
return {
mode:"SYNTHETIC_BDD", isolated:true, persistentStateUnchanged:state===savedState,
total:results.length,passed:results.length-failed.length,failed:failed.length,
passedAt:nowISO(),results
};
}

const page = [
"<!doctype html><html lang='zh-Hant'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>",
"<title>K Signal Paper Lab | 模擬交易績效</title>",
"<style>",
":root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,sans-serif;background:#0b1020;color:#ecf1fd}",
"*{box-sizing:border-box}body{margin:0}.wrap{max-width:1180px;margin:auto;padding:28px 20px 60px}",
"header{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin:0 0 24px}",
"h1{font-size:25px;margin:0 0 7px;letter-spacing:-.5px}small,.muted{color:#91a2c5}",
".pill{background:#142e2e;border:1px solid #2f766b;color:#83e0bd;padding:7px 12px;border-radius:24px;font-size:12px;font-weight:700}",
".warning{color:#ffca7a;background:#30291c;border:1px solid #67532d;border-radius:12px;padding:12px 14px;margin:0 0 24px;font-size:13px;line-height:1.5}",
".cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0 26px}",
".card,.panel{background:#111a2e;border:1px solid #26334d;border-radius:16px;padding:18px}",
".ledger{border:1px solid #2b3b5b;border-radius:20px;padding:18px 18px 1px;margin:22px 0;background:#0e1629}.ledger.telegram{border-color:#315b75;background:#0d1928}.ledger.donchian{border-color:#5c4b2c;background:#19170f}.ledger .section{margin:0 0 8px}.ledger-badge{font-size:11px;font-weight:750;letter-spacing:.05em;padding:5px 9px;border-radius:999px;color:#b9dfff;background:#18364b}.donchian .ledger-badge{color:#ffd792;background:#46371e}",
".card label{display:block;color:#9eaed0;font-size:12px;margin-bottom:10px}.value{font-size:27px;font-weight:740;letter-spacing:-1px}.sub{color:#8a9bbf;font-size:12px;margin-top:7px}",
".positive{color:#58d5ae}.negative{color:#ff879a}.section{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:26px 0 12px}h2{font-size:17px;margin:0}",
".panel{overflow:auto}table{width:100%;border-collapse:collapse;min-width:760px;font-size:13px;text-align:left}",
"th{font-size:11px;color:#8fa2c6;text-transform:uppercase;letter-spacing:.08em}td,th{padding:12px 11px;border-bottom:1px solid #25314b;white-space:nowrap}",
"a{color:#7eb5ff;text-decoration:none}a:hover{text-decoration:underline}.tag{padding:4px 7px;border-radius:6px;background:#27314a;font-size:11px}",
".pager{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px;color:#91a2c5;font-size:12px}.pager button{border:1px solid #344463;background:#17233b;color:#dce7fb;border-radius:8px;padding:7px 11px;cursor:pointer}.pager button:hover:not(:disabled){border-color:#6297d6}.pager button:disabled{opacity:.4;cursor:not-allowed}",
".chart{width:100%;height:210px;display:block}footer{color:#8193b5;font-size:12px;line-height:1.7;margin-top:26px}",
".status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#9fb2d8}",
".dot{width:8px;height:8px;border-radius:50%;background:#50d4a7;display:inline-block}",
"@media(max-width:760px){.cards{grid-template-columns:1fr}.value{font-size:23px}.wrap{padding:16px 10px 40px}h1{font-size:22px}.ledger{padding:14px 10px 1px;border-radius:16px}.panel{padding:12px;overflow:visible}.section{align-items:flex-start;flex-wrap:wrap}.responsive-table{min-width:0;display:block}.responsive-table thead{display:none}.responsive-table tbody{display:grid;gap:12px}.responsive-table tr{display:block;border:1px solid #2b3956;border-radius:12px;padding:7px 10px;background:#0e172a}.responsive-table td{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:8px 0;border-bottom:1px solid #22304a;white-space:normal;text-align:right}.responsive-table td::before{content:attr(data-label);color:#8fa2c6;font-size:11px;font-weight:700;letter-spacing:.04em;text-align:left}.responsive-table td:last-child{border-bottom:0}.responsive-table td[colspan]{display:block;text-align:center}.responsive-table td[colspan]::before{display:none}.pager{justify-content:center;flex-wrap:wrap}}",
"</style></head><body><div class='wrap'>",
"<header><div><h1>K Signal Paper Lab</h1><small>Telegram 訊號監控 · Binance 標記價格 · 模擬交易績效</small></div><span class='pill'>● PAPER ONLY — 非真實下單</span></header>",
"<div class='warning'>本系統只模擬，無任何真實交易；持倉在扣除雙向手續費（單邊 0.04%）及模擬滑價（單邊 0.02%）後，剩餘倉位淨獲利達進場名目金額的 +1% 自動全平。止損及頻道明確平倉指令仍有效；尚未計入 Funding Fee、強平與真實訂單簿深度。歷史訊號不倒填成交。</div>",
"<div class='panel' style='margin-bottom:20px'><h2>Telegram 即時推播 — @twjavaleon</h2><p class='muted' id='tgStatus' style='font-size:13px'>檢查配對狀態中...</p><a id='tgPair' style='display:none' target='_blank' rel='noopener noreferrer'>開啟 Telegram Bot 完成配對</a></div>",
"<div class='status' id='status'>● 連線檢查中...</div>",
"<div class='ledger telegram'><div class='section'><div><h2>Telegram 訊號 Paper 帳本</h2><small>來源：KCryptoBTC168；獨立計算淨值與績效</small></div><span class='ledger-badge'>獨立帳本 A</span></div>",
"<div class='cards'>",
"<div class='card'><label>Telegram Paper 淨值</label><div class='value' id='equity'>—</div><div class='sub'>此帳本期初 10,000 USDT</div></div>",
"<div class='card'><label>總報酬率</label><div class='value' id='return'>—</div><div class='sub' id='realized'>已實現 —</div></div>",
"<div class='card'><label>已平倉 / 勝率</label><div class='value' id='win'>—</div><div class='sub' id='pf'>盈虧因子 —</div></div>",
"<div class='card'><label>最大回撤</label><div class='value' id='dd'>—</div><div class='sub' id='orders'>持倉與掛單 —</div></div>",
"</div></div><div class='ledger donchian'><div class='section'><div><h2>1H Donchian + EMA200 + ATR Paper 帳本</h2><small>新建倉策略：1h 20期突破、EMA200方向過濾、2×ATR14停損、2R停利；Demo 下單停用</small></div><span class='ledger-badge'>獨立帳本 B</span></div>",
"<div class='cards'><div class='card'><label>Donchian 訊號</label><div class='value' id='dSignals'>—</div><div class='sub' id='dSignalSub'>建倉 / 平倉</div></div>",
"<div class='card'><label>Donchian Paper 持倉 / 平倉</label><div class='value' id='dWin'>—</div><div class='sub' id='dPnl'>損益 —</div></div>",
"<div class='card'><label>Donchian Paper 淨值</label><div class='value' id='dPaperEquity'>—</div><div class='sub'>此帳本期初 10,000 USDT</div></div>",
"<div class='card'><label>Demo 實際已平倉</label><div class='value' id='dActual'>—</div><div class='sub'>Demo 下單仍停用</div></div></div>",
"<div class='warning' id='dStatus'>新建倉已替換為 1H Donchian + EMA200 + ATR；既有 Legacy 15m 持倉依原規則結束。此區不與 Telegram Paper 淨值相加，也不會送出 Binance Demo 或正式訂單。</div></div>",
"<div class='section'><h2>Donchian Paper 模擬持倉明細</h2><small>每筆名目 100 USDT；含手續費與模擬滑價</small></div>",
"<div class='panel'><table class='responsive-table'><thead><tr><th>幣別</th><th>方向</th><th>策略</th><th>狀態</th><th>建倉參考</th><th>即時標記價</th><th>行情時間</th><th>停損</th><th>停利</th><th>未實現損益</th><th>訊號時間</th><th>K線</th></tr></thead><tbody id='dPositions'><tr><td colspan='12'>尚無 Paper 持倉</td></tr></tbody></table></div>",
"<div class='section'><h2>Donchian Paper 平倉紀錄</h2><small>平倉後永久保留於獨立 Paper 帳本；最多顯示最近 100 筆</small></div>",
"<div class='panel'><table class='responsive-table'><thead><tr><th>幣別</th><th>方向</th><th>策略</th><th>狀態</th><th>建倉參考</th><th>模擬進場</th><th>模擬出場</th><th>原因</th><th>費用</th><th>淨損益</th><th>平倉時間</th><th>K線</th></tr></thead><tbody id='dClosedPositions'><tr><td colspan='12'>尚無 Donchian Paper 平倉紀錄</td></tr></tbody></table></div>",
"<div class='section'><h2>Telegram Paper 資金曲線</h2><small>每分鐘快照，只代表獨立帳本 A</small></div>",
"<div class='panel'><svg class='chart' id='chart' viewBox='0 0 900 210' preserveAspectRatio='none'></svg></div>",
"<div class='section'><h2>Telegram Paper 模擬交易紀錄</h2><a href='/api/orders.csv' target='_blank'>匯出 CSV</a></div>",
"<div class='panel'><table class='responsive-table'><thead><tr><th>原始訊號</th><th>幣種</th><th>方向</th><th>狀態</th><th>進場區間</th><th>進場 / 出場</th><th>淨損益</th><th>K線</th></tr></thead><tbody id='trades'><tr><td colspan='8'>載入中...</td></tr></tbody></table><div class='pager'><button id='tradesPrev' type='button'>上一頁</button><span id='tradesPage'>第 1 / 1 頁 · 每頁 10 筆</span><button id='tradesNext' type='button'>下一頁</button></div></div>",
"<div class='section'><h2>每日損益</h2><small>UTC 日期</small></div>",
"<div class='panel'><table class='responsive-table'><thead><tr><th>日期</th><th>交易數</th><th>勝場</th><th>已實現損益</th></tr></thead><tbody id='daily'><tr><td colspan='4'>尚無已平倉交易</td></tr></tbody></table></div>",
"<footer>來源：<a href='https://t.me/KCryptoBTC168' target='_blank'>KCryptoBTC168</a> 公開預覽 · 記錄不可代表頻道長期實盤績效 · 市價/掛單填單僅按 15 秒輪詢中實際取得的 Binance 標記價格判斷 · 無槓桿或真實下單。</footer>",
"</div><script>",
"const $=id=>document.getElementById(id);",
"const fmt=(n,d=2)=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});",
"const pnl=n=>'<span class=\"'+(n>=0?'positive':'negative')+'\">'+(n>=0?'+':'')+fmt(n)+'</span>';",
"const validMetric=n=>typeof n==='number'&&Number.isFinite(n);",
"const fmtObserved=(n,d=2)=>validMetric(n)?fmt(n,d):'—';",
"const pnlObserved=n=>validMetric(n)?pnl(n):'—';",
"const countObserved=n=>Number.isSafeInteger(n)&&n>=0?String(n):'—';",
"const clean=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));",
"const telegramChartUrl=symbol=>'https://www.tradingview.com/chart/?symbol=BINANCE%3A'+encodeURIComponent(String(symbol||''))+'.P&interval=15';",
"const telegramSourceCell=id=>Number.isSafeInteger(id)&&id>0?'<a href=\"https://t.me/KCryptoBTC168/'+id+'\" target=\"_blank\" rel=\"noopener noreferrer\">#'+id+'</a>':'<span aria-label=\"來源訊號不可用\">—</span>';",
"const telegramChartCell=symbol=>typeof symbol==='string'&&/^[A-Z0-9]{3,16}$/.test(symbol)?'<a target=\"_blank\" rel=\"noopener noreferrer\" href=\"'+telegramChartUrl(symbol)+'\">15m K線</a>':'<span aria-label=\"行情連結不可用\">—</span>';",
"const donchianChartCell=x=>{const m=String(x?.chartUrl||'').match(/^https:\\/\\/www\\.tradingview\\.com\\/chart\\/\\?symbol=BINANCE%3A([A-Z0-9]{3,16})\\.P&interval=(15|60)$/);return m?'<a target=\"_blank\" rel=\"noopener noreferrer\" href=\"https://www.tradingview.com/chart/?symbol=BINANCE%3A'+m[1]+'.P&interval='+m[2]+'\">'+(m[2]==='60'?'1h':'15m')+' K線</a>':'<span aria-label=\"行情連結不可用\">—</span>';};",
"const TELEGRAM_TRADE_PAGE_SIZE=10;let telegramTradePage=1,telegramTradeRows=[];const priceRange=x=>Number.isFinite(x.entryLow)&&Number.isFinite(x.entryHigh)?fmt(x.entryLow)+' – '+fmt(x.entryHigh):'—';",
"function renderTelegramTrades(){const total=Math.max(1,Math.ceil(telegramTradeRows.length/TELEGRAM_TRADE_PAGE_SIZE));telegramTradePage=Math.min(Math.max(1,telegramTradePage),total);const start=(telegramTradePage-1)*TELEGRAM_TRADE_PAGE_SIZE,rows=telegramTradeRows.slice(start,start+TELEGRAM_TRADE_PAGE_SIZE);$('trades').innerHTML=rows.length?rows.map(x=>'<tr><td data-label=\"原始訊號\">'+telegramSourceCell(x.messageId)+'</td><td data-label=\"幣種\">'+clean(x.symbol)+'</td><td data-label=\"方向\">'+clean(x.side)+'</td><td data-label=\"狀態\"><span class=\"tag\">'+clean(x.status)+'</span></td><td data-label=\"進場區間\">'+priceRange(x)+'</td><td data-label=\"進場 / 出場\">'+(x.entryPrice?fmt(x.entryPrice):'—')+' / '+(x.exitPrice?fmt(x.exitPrice):'—')+'</td><td data-label=\"淨損益\">'+((x.status==='closed')?pnl(x.netPnl):'—')+'</td><td data-label=\"K線\">'+telegramChartCell(x.symbol)+'</td></tr>').join(''):'<tr><td colspan=\"8\">目前沒有有效的新交易訊號；不倒填歷史成交。</td></tr>';$('tradesPage').textContent='第 '+telegramTradePage+' / '+total+' 頁 · 每頁 10 筆';$('tradesPrev').disabled=telegramTradePage<=1;$('tradesNext').disabled=telegramTradePage>=total;}",
"function moveTelegramTradePage(delta){telegramTradePage+=delta;renderTelegramTrades();}",
"$('tradesPrev').addEventListener('click',()=>moveTelegramTradePage(-1));$('tradesNext').addEventListener('click',()=>moveTelegramTradePage(1));",
"async function tick(){try{",
"const [r,o,s]=await Promise.all(['/api/report','/api/orders','/api/status'].map(u=>fetch(u).then(x=>x.json())));",
"$('equity').textContent=fmt(r.equity)+' USDT';$('return').innerHTML=pnl(r.netReturnPct)+'%';",
"$('realized').textContent='已實現 '+fmt(r.realizedPnl)+' USDT';",
"$('win').textContent=r.closedTrades+' / '+fmt(r.winRatePct,1)+'%';",
"$('pf').textContent='盈虧因子 '+(r.profitFactor==null?'—':fmt(r.profitFactor));",
"$('dd').textContent=fmt(r.maxDrawdownPct)+'%';",
"$('orders').textContent='持倉 '+r.openPositions+' / 掛單 '+r.pendingOrders+' / 部分平倉 '+(r.partialExits||0);",
"const d=r.donchianDemo||{},dp=d.performance||{},pp=d.paper||{},ds=d.signals||{};",
"const defaultDonchianStatus='新建倉已替換為 1H Donchian + EMA200 + ATR；既有 Legacy 15m 持倉依原規則結束。此區不與 Telegram Paper 淨值相加，也不會送出 Binance Demo 或正式訂單。';",
"$('dStatus').textContent=d.stale?'⚠️ Donchian 上游統計未更新或可能過期；下列數值只供歷史參考，不能視為即時行情。最後成功取得：'+(d.lastSuccessAt||'未知'):(d.error?'⚠️ Donchian 統計不可用：'+d.error:defaultDonchianStatus);",
"$('dSignals').textContent=d.available?countObserved(ds.total):'—';$('dSignalSub').textContent=d.available?'建倉 '+countObserved(ds.entries)+' / 平倉 '+countObserved(ds.exits):'等待上游資料';",
"$('dWin').textContent=d.available?countObserved(pp.openPositions)+' / '+countObserved(pp.closedTrades):'—';$('dPnl').innerHTML=d.available?'已實現 '+pnlObserved(pp.realizedPnl)+' / 未實現 '+pnlObserved(pp.unrealizedPnl):'損益 —';",
"$('dPaperEquity').textContent=d.available?(validMetric(pp.equity)?fmt(pp.equity)+' USDT':'—'):'—';$('dActual').textContent=d.available?countObserved(dp.closedTrades):'—';",
"const strategyName=x=>String(x.strategyVersion||'').includes('1H_')?'1H EMA+ATR':'Legacy 15m';",
"const ps=d.positions||[];$('dPositions').innerHTML=ps.length?ps.map(x=>'<tr><td data-label=\"幣別\">'+clean(x.symbol)+'</td><td data-label=\"方向\">'+clean(x.side)+'</td><td data-label=\"策略\"><span class=\"tag\">'+strategyName(x)+'</span></td><td data-label=\"狀態\"><span class=\"tag\">Paper 模擬持倉</span></td><td data-label=\"建倉參考\">'+fmtObserved(x.entryPrice)+'</td><td data-label=\"即時標記價\">'+fmtObserved(x.lastPrice)+'</td><td data-label=\"行情時間\">'+clean(x.lastPriceAt||'—')+'</td><td data-label=\"停損\">'+fmtObserved(x.stopLoss)+'</td><td data-label=\"停利\">'+fmtObserved(x.takeProfit)+'</td><td data-label=\"未實現損益\">'+pnlObserved(x.paperPnl)+'</td><td data-label=\"訊號時間\">'+clean(x.entryTime||'—')+'</td><td data-label=\"K線\">'+donchianChartCell(x)+'</td></tr>').join(''):'<tr><td colspan=\"12\">尚無 Paper 持倉</td></tr>';",
"const cs=d.closedPositions||[];$('dClosedPositions').innerHTML=cs.length?cs.map(x=>'<tr><td data-label=\"幣別\">'+clean(x.symbol)+'</td><td data-label=\"方向\">'+clean(x.side)+'</td><td data-label=\"策略\"><span class=\"tag\">'+strategyName(x)+'</span></td><td data-label=\"狀態\"><span class=\"tag\">已平倉</span></td><td data-label=\"建倉參考\">'+fmtObserved(x.referenceEntry)+'</td><td data-label=\"模擬進場\">'+fmtObserved(x.entryPrice)+'</td><td data-label=\"模擬出場\">'+fmtObserved(x.exitPrice)+'</td><td data-label=\"原因\">'+clean(x.exitReason||'—')+'</td><td data-label=\"費用\">'+fmtObserved(x.fees)+'</td><td data-label=\"淨損益\">'+pnlObserved(x.netPnl)+'</td><td data-label=\"平倉時間\">'+clean(x.exitTime||'—')+'</td><td data-label=\"K線\">'+donchianChartCell(x)+'</td></tr>').join(''):'<tr><td colspan=\"12\">尚無 Donchian Paper 平倉紀錄</td></tr>';",
"$('status').textContent='● 訊號：'+(s.channelError?'讀取異常':'正常')+' | 首次建立基線：'+(s.initialized?'完成':'等待中')+' | 最後訊號輪詢 '+(s.lastChannelPollAt||'—')+' | 已記錄貼文 '+s.messagesCaptured+' | 最後行情 '+(s.lastPricePollAt||'—')+(s.channelError?' | '+s.channelError:'')+(s.priceError?' | 行情錯誤：'+s.priceError:'');",
"telegramTradeRows=o.slice().reverse().slice(0,100);renderTelegramTrades();",
"const days=Object.entries(r.daily).sort((a,b)=>b[0].localeCompare(a[0]));",
"$('daily').innerHTML=days.length?days.map(([k,v])=>'<tr><td data-label=\"日期\">'+k+'</td><td data-label=\"交易數\">'+v.trades+'</td><td data-label=\"勝場\">'+v.wins+'</td><td data-label=\"已實現損益\">'+pnl(v.pnl)+'</td></tr>').join(''):'<tr><td colspan=\"4\">尚無已平倉交易</td></tr>';",
"const points=r.snapshots.length?r.snapshots.map(v=>v.equity):[10000];",
"const low=Math.min(...points)-1,high=Math.max(...points)+1,span=Math.max(2,high-low);",
"let poly=points.map((v,i)=>(points.length===1?0:i/(points.length-1)*900).toFixed(2)+','+(195-(v-low)/span*175).toFixed(2)).join(' ');",
"$('chart').innerHTML='<line x1=\"0\" y1=\"195\" x2=\"900\" y2=\"195\" stroke=\"#3a4969\"/><polyline points=\"'+poly+'\" fill=\"none\" stroke=\"#62d6b6\" stroke-width=\"2.5\" vector-effect=\"non-scaling-stroke\"/>';",
"}catch(e){$('status').textContent='● 儀表板讀取失敗：'+e.message}}",
"tick();setInterval(tick,30000);",
"async function tgPanel(){try{const s=await fetch('/api/telegram/status').then(x=>x.json());const el=$('tgStatus');$('tgPair').style.display='none';if(s.paired){el.textContent='已綁定 '+s.targetUsername+' · 已成功推播 '+s.delivered+' 則 · 待送 '+s.queued+' 則';return;}el.textContent='Telegram 尚未完成配對；配對設定僅限受保護的管理端。';}catch(err){$('tgStatus').textContent='Telegram 配對狀態讀取失敗：'+err.message;}}",
"tgPanel();setInterval(tgPanel,25000);",
"</script></body></html>"
].join("\n");
function route(req) {
const u = new URL(req.url);
if (u.pathname === "/healthz") return json({ ok: true, mode: "paper_only", app: "k-signal-paper-lab" });
if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
if (u.pathname === "/" && req.method === "GET")
return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8",
"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
if (u.pathname === "/api/status") return json(publicPaperStatus());
if (u.pathname === "/api/telegram/status") return json(publicTelegramStatus());
if (u.pathname === "/api/report") return json(report());
if (u.pathname === "/api/orders") return json(publicOrders());
if (u.pathname === "/api/orders.csv") return new Response(csv(), {
headers: { "Content-Type": "text/csv; charset=utf-8",
"Content-Disposition": 'attachment; filename="k_signal_paper_trades.csv"',
"Cache-Control": "no-store" }
});
if (!authOk(req)) return new Response("Login required", {
status: 401, headers: { "WWW-Authenticate": 'Basic realm="K Signal Paper Lab Admin"',
"Cache-Control": "no-store", "Content-Type": "text/plain" }
});
if (u.pathname === "/api/telegram/setup") return json(telegramSetup());
if (u.pathname === "/api/selftest") return json(runBDDTests());
if (u.pathname === "/api/messages") return json(state.messages.slice(-100).reverse());
if (u.pathname === "/api/quotes") return json(state.quotes);
return new Response("Not Found", { status: 404 });
}

function verifyProfitAccountingAtBoot() {
const a = { status: "open", side:"long", entryPrice:100, qty:1, initialQty:1,
feeEntry:0.04, feeExit:0, grossPnl:0, exitEvents:[] };
if (closeFraction("兩倍了 減倉") !== 0.5 ||
closeFraction("減倉30%") !== 0.30 ||
closeFraction("全部平倉") !== 1 ||
closeMsg("賺錢了") ||
!closeMsg("兩倍了 減倉")) throw Error("close parser validation failed");
closeOrder(a,110,"channel_partial_take_profit",0.5,200,true);
if(a.status!=="open" || Math.abs(a.qty-0.5)>1e-9 ||
a.exitEvents.length!==1 || !(realizedOf(a)>0) || !a.exitEvents[0].assumedRatio)
throw Error("partial profit accounting validation failed");
const equityDelta = realizedOf(a)+unrealizedOf(a,105);
if(!(equityDelta>7 && equityDelta<8)) throw Error("realized/unrealized split validation failed");
closeOrder(a,90,"stop_loss");
if(a.status!=="closed" || a.qty!==0 || a.exitEvents.length!==2 ||
Math.abs(a.netPnl - a.exitEvents.reduce((sum,x)=>sum+x.netPnl,0))>1e-7)
throw Error("final partial close validation failed");
const b = {status:"open",side:"short",entryPrice:100,qty:1,initialQty:1,
feeEntry:0.04,feeExit:0,grossPnl:0,exitEvents:[]};
closeOrder(b,90,"take_profit");
if(b.status!=="closed" || b.netPnl<9 || b.exitEvents.length!==1)
throw Error("short take-profit validation failed");
}
notificationsMutedForStartupTests = true;
try { verifyProfitAccountingAtBoot(); } finally { notificationsMutedForStartupTests = false; }
const bootBDD=runBDDTests();
console.info("BOOT_BDD_RESULTS",JSON.stringify({total:bootBDD.total,passed:bootBDD.passed,failed:bootBDD.failed,failures:bootBDD.results.filter(x=>!x.pass)}));
if(bootBDD.failed || !bootBDD.persistentStateUnchanged)throw Error("BDD regression failed: "+bootBDD.failed);
Bun.serve({ hostname: "0.0.0.0", port: Number(Bun.env.PORT || 8080), fetch: route });


async function channelLoop() {
await pollChannel();
setTimeout(channelLoop, 60000);
}
async function priceLoop() {
await pollPrices();
setTimeout(priceLoop, 15000);
}
void channelLoop();
void priceLoop();
async function donchianStatsLoop(){
await refreshDonchianStats();
setTimeout(donchianStatsLoop,30000);
}
void donchianStatsLoop();
async function telegramLoop() {
await telegramPolling();
if(TELEGRAM_BOT_TOKEN && tgState().chatId) {
if(queueNotice("telegram:correction:synthetic-boot-exits:v1",
"⚠️ K Signal Paper Lab 通知更正\n"+
"先前可能收到兩則模擬平倉通知，其實來自程式啟動時的內部測試，並非 Telegram 頻道真實訊號，也不代表正式模擬帳本已平倉。\n"+
"我們已阻止沒有有效來源訊號 ID 的測試交易發送通知，並新增回歸測試。\n"+
"正式模擬交易及淨利 1% 止盈規則繼續運作。"))persist();
}
if (TELEGRAM_BOT_TOKEN && tgState().chatId) {
// Single opt-in delivery verification after a successful pairing. Persisted key prevents repeats on deploy.
if(queueNotice("telegram:activation-check:v1",
"✅ K Signal Paper Lab 通知測試成功啟動\n"+
"接收帳號：@"+TG_TARGET+"\n"+
"之後將收到新交易訊號、模擬開倉、部分平倉、淨利達1%止盈、止損與重要異常通知。\n"+
"本系統只做模擬，不執行真實交易。")) persist();
}
await flushTelegramOutbox();
setTimeout(telegramLoop,15000);
}
void telegramLoop();
