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
  return {
    mode: "PAPER_ONLY", initialBalance: START_BALANCE, netTakeProfitPct: NET_TAKE_PROFIT*100, equity: equity(),
    netReturnPct: (equity() / START_BALANCE - 1) * 100,
    realizedPnl: realized, unrealizedPnl: unrealized,
    openPositions: open.length, pendingOrders: state.orders.filter(x => x.status === "pending").length,
    closedTrades: closed.length, partialExits, winRatePct: closed.length ? wins.length / closed.length * 100 : 0,
    profitFactor: lossGross > 0 ? winGross / lossGross : null, maxDrawdownPct: maxDD,
    feesPaid: state.orders.reduce((v, o) => v + (o.feeEntry || 0) + (o.feeExit || 0), 0),
    daily, monthly, symbols, snapshots: state.snapshots.slice(-1000)
  };
}
function csv() {
  const fields = ["messageId", "symbol", "side", "kind", "status", "entryLow", "entryHigh",
    "entryPrice", "stop", "target", "qty", "exitPrice", "feeEntry", "feeExit",
    "grossPnl", "netPnl", "receivedAt", "entryTime", "exitTime", "reason", "initialQty", "lastPartialTime", "exitEvents"];
  return [fields.join(","), ...state.orders.map(o => fields.map(k => {
    const v = k === "messageId" ? "https://t.me/KCryptoBTC168/" + o[k] : (k === "exitEvents" ? JSON.stringify(o[k]||[]) : String(o[k] ?? ""));
    return '"' + v.replace(/"/g, '""') + '"';
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
  test("BDD01 首次同步只做基線、不開歷史倉", () => {
    state = fresh();
    ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:current(),replyTo:null}],()=>{});
    assert(state.initialized && state.lastSeenId===5001 && state.orders.length===0,"baseline must not place orders");
  });
  test("BDD02 多單訊號解析", () => {
    const x=signal("#ZEC 市價 1225-1200附近小多（20-30x） 止損 1168");
    assert(x.reason==="ok" && x.symbol==="ZECUSDT" && x.side==="long" &&
      x.kind==="market" && x.low===1200 && x.high===1225 && x.stop===1168,"long parse error");
  });
  test("BDD03 空單訊號解析", () => {
    const x=signal("#ZEC 掛單 1250-1265附近空 止損 1288");
    assert(x.reason==="ok" && x.side==="short" && x.kind==="limit" &&
      x.low===1250 && x.high===1265,"short parse error");
  });
  test("BDD04 缺少止損的訊號不下單", () => {
    const x=signal("#SOL 市價 99-101附近多");
    assert(x.reason==="stop_missing","missing SL accepted");
  });
  test("BDD05 新訊號僅生成指令，不偽造成交", () => {
    state.lastSeenId=5000;
    const msg={id:5001,text:"#SOL 市價 99-101附近多 止損 95",
      publishedAt:current(),replyTo:null};
    ingest([msg],()=>{});
    assert(state.orders.length===1 && state.orders[0].status==="waiting_price", "market order should await price");
    ingest([msg],()=>{});
    assert(state.orders.length===1,"duplicate message created duplicate order");
  });
  test("BDD06 市價在區間內才模擬開倉", () => {
    const o=mock({status:"waiting_price"});state.orders=[o];
    handlePrice("SOLUSDT",100);
    assert(o.status==="open" && o.qty>0 && o.entryPrice>100, "market entry failed");
  });
  test("BDD07 市價超出區間不得偽造成交", () => {
    const o=mock({status:"waiting_price"});state.orders=[o];
    handlePrice("SOLUSDT",105);
    assert(o.status==="rejected" && !o.qty,"out-of-range market order filled");
  });
  test("BDD08 掛單必須先觸價才開倉", () => {
    const o=mock();state.orders=[o];
    handlePrice("SOLUSDT",120);
    assert(o.status==="pending","out-of-range limit filled");
    handlePrice("SOLUSDT",100);
    assert(o.status==="open","limit was not filled in range");
  });
  test("BDD09 超過24小時未成交掛單到期", () => {
    const o=mock({receivedAt:new Date(Date.now()-25*3600*1000).toISOString()});
    state.orders=[o];handlePrice("SOLUSDT",100);
    assert(o.status==="expired","old order filled");
  });
  test("BDD10 原訊號的取消掛單連動", () => {
    const o=mock();state.orders=[o];state.lastSeenId=5001;
    ingest([{id:5002,text:"取消掛單 沒有接到",replyTo:5001,publishedAt:current()}],()=>{});
    assert(o.status==="cancelled" && state.orders.length===1,"cancel reply failed");
  });
  test("BDD11 有新鮮報價才允許模擬成交", () => {
    const o=mock({status:"waiting_price",receivedAt:new Date(Date.now()-AGE-3000).toISOString()});
    state.orders=[o];handlePrice("SOLUSDT",100);
    assert(o.status==="rejected","stale market quote filled");
  });
  test("BDD12 每筆風險與名目倉位上限", () => {
    const o=mock();state.orders=[o];openOrder(o,100);
    assert(o.qty*o.entryPrice<=START_BALANCE*MAX_POSITION+1e-5,"position cap exceeded");
    assert(o.qty*Math.abs(o.entryPrice-o.stop)<=START_BALANCE*RISK+1e-5,"risk cap exceeded");
  });
  test("BDD13 做多止損計入不利滑價", () => {
    const o=mock();state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",94);
    assert(o.status==="closed" && o.reason==="stop_loss" && o.exitPrice<94 && o.netPnl<0,"long stop wrong");
  });
  test("BDD14 做空止損計入不利滑價", () => {
    const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",106);
    assert(o.status==="closed" && o.exitPrice>106 && o.netPnl<0,"short stop wrong");
  });
  test("BDD15 多單明確止盈價", () => {
    const o=mock({target:110});state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",111);
    assert(o.status==="closed" && o.reason==="take_profit" && o.netPnl>0,"long TP wrong");
  });
  test("BDD16 空單明確止盈價", () => {
    const o=mock({side:"short",stop:105,target:90});state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",89);
    assert(o.status==="closed" && o.reason==="take_profit" && o.netPnl>0,"short TP wrong");
  });
  test("BDD17 頻道無比例減倉，預設模擬減半", () => {
    assert(closeMsg("兩倍了 減倉") && !closeMsg("賺錢了 兄弟們"),"exit text classification wrong");
    near(closeFraction("兩倍了 減倉"),0.5);
    const o=mock();state.orders=[o];openOrder(o,100);
    const initial=o.qty;
    closeOrder(o,110,"channel_partial_take_profit",0.5,5002,true);
    near(o.qty,initial/2);
    assert(o.status==="open" && o.exitEvents[0].assumedRatio &&
      realizedOf(o)>0,"partial exit not realized");
  });
  test("BDD18 明示30%、一半及1/3減倉比例", () => {
    near(closeFraction("減倉 30%"),0.3);
    near(closeFraction("平一半"),0.5);
    near(closeFraction("減倉 1/3"),1/3);
  });
  test("BDD19 關聯Telegram回覆執行部分止盈", () => {
    const o=mock();state.orders=[o];openOrder(o,100);
    state.lastSeenId=5001;
    ingest([{id:5002,text:"兩倍了 減倉",replyTo:5001,publishedAt:current()}],()=>{});
    assert(o.pendingCloseCommands.length===1 && o.status==="open","reply queue failed");
    handlePrice("SOLUSDT",100.5);
    assert(o.status==="open" && o.exitEvents.length===1 && o.qty<o.initialQty,"reply not executed");
  });
  test("BDD20 重複收到同一回覆不可重複減倉", () => {
    const o=mock();state.orders=[o];openOrder(o,100);
    state.lastSeenId=5001;
    const msg={id:5002,text:"兩倍了 減倉",replyTo:5001,publishedAt:current()};
    ingest([msg],()=>{}); handlePrice("SOLUSDT",100.5);ingest([msg],()=>{});
    handlePrice("SOLUSDT",100.6);
    assert(o.exitEvents.length===1,"duplicate reply doubled exit");
  });
  test("BDD21 頻道全部平倉需完成結算", () => {
    const o=mock();state.orders=[o];openOrder(o,100);state.lastSeenId=5001;
    ingest([{id:5002,text:"全部平倉",replyTo:5001,publishedAt:current()}],()=>{});
    handlePrice("SOLUSDT",100.5);
    assert(o.status==="closed" && o.qty===0 && o.exitEvents.length===1 &&
      o.netPnl>0,"full close failed");
  });
  test("BDD22 減倉獲利和未實現損益正確拆開", () => {
    const o=mock();state.orders=[o];openOrder(o,100);
    const entryQty=o.qty;closeOrder(o,110,"partial",0.5,5002,true);
    const rep=report();const expectedRealized=o.exitEvents[0].netPnl;
    near(rep.realizedPnl,expectedRealized);
    near(rep.unrealizedPnl,unrealizedOf(o,o.entryPrice));
    near(rep.equity,START_BALANCE+rep.realizedPnl+rep.unrealizedPnl);
    near(o.qty,entryQty/2);
  });
  test("BDD23 減倉後觸發止損，不重複計算獲利", () => {
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"partial",0.5,5002,true);
    handlePrice("SOLUSDT",94);
    assert(o.status==="closed" && o.exitEvents.length===2,"remaining stop missing");
    near(o.netPnl,o.exitEvents.reduce((sum,x)=>sum+x.netPnl,0));
    near(equity(),START_BALANCE+o.netPnl);
  });
  test("BDD24 每日/月度績效納入部分平倉腿", () => {
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"partial",0.5,5002,true);
    closeOrder(o,108,"full",1,5003,false);
    const r=report(),d=current().slice(0,10),m=d.slice(0,7);
    assert(r.daily[d].trades===2 && r.monthly[m].trades===2 &&
      r.partialExits===1,"leg-count mismatch");
    near(r.daily[d].pnl,o.netPnl);
    near(r.symbols.SOLUSDT.pnl,o.netPnl);
  });
  test("BDD25 手續費與滑價降低實際淨損益", () => {
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"take_profit");
    assert(o.feeEntry>0 && o.feeExit>0 &&
      o.netPnl<o.grossPnl && o.entryPrice>100 && o.exitPrice<110,
      "fees/slippage not charged");
  });
  test("BDD26 Telegram 回覆關聯HTML正確解析", () => {
    const html='<div data-post="KCryptoBTC168/5001"><div class="tgme_widget_message_text js-message_text">#SOL<br>市價 99-101附近多 止損 95</div><time datetime="'+current()+'"></time></div>'+
      '<div data-post="KCryptoBTC168/5002"><a class="tgme_widget_message_reply" href="https://t.me/KCryptoBTC168/5001">quoted</a>'+
      '<div class="tgme_widget_message_text js-message_text">兩倍了 減倉</div><time datetime="'+current()+'"></time></div>';
    const x=parseChannel(html);
    assert(x.length===2 && x[1].replyTo===5001 && x[1].text==="兩倍了 減倉","reply parsing mismatch");
  });
  test("BDD27 過期新訊號不補歷史成交", () => {
    state.lastSeenId=5000;
    ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",
      publishedAt:new Date(Date.now()-15*60*1000).toISOString(),replyTo:null}],()=>{});
    assert(state.orders.length===0 && state.messages[0].classification==="stale_or_missing_timestamp","stale message accepted");
  });
  test("BDD28 未關聯的獲利留言不觸發出場", () => {
    const o=mock();state.orders=[o];openOrder(o,100);state.lastSeenId=5001;
    ingest([{id:5002,text:"賺錢了兄弟們",replyTo:5001,publishedAt:current()}],()=>{});
    handlePrice("SOLUSDT",100.5);
    assert(o.status==="open" && o.exitEvents.length===0,"profit comment caused exit");
  });

  // Parsing and Telegram ingestion — synthetic messages only.
  test("BDD29 幣種小寫標籤正常解析",()=>{
    const x=signal("#sol 市價 99-101附近多 止損 95");
    assert(x.reason==="ok" && x.symbol==="SOLUSDT","lowercase ticker not normalized");
  });
  test("BDD30 非 Binance 合約 XAU 必須拒絕",()=>{
    const x=signal("#XAU 市價 4000-4010附近多 止損 3900");
    assert(x.reason==="unsupported_market_XAU","unsupported gold market accepted");
  });
  test("BDD31 未列入白名單的幣種不得成交",()=>{
    assert(signal("#NOTREAL 市價 99-101附近多 止損 95").reason==="not_trade_signal","unknown ticker accepted");
  });
  test("BDD32 評論不是建倉訊號",()=>{
    assert(signal("#BTC 長期趨勢仍可能看多").reason==="not_trade_signal","commentary traded");
  });
  test("BDD33 多單止損高於進場區間應拒絕",()=>{
    assert(signal("#SOL 市價 99-101附近多 止損 102").reason==="invalid_risk_levels","bad long stop accepted");
  });
  test("BDD34 多單止損等於進場下緣應拒絕",()=>{
    assert(signal("#SOL 市價 99-101附近多 止損 99").reason==="invalid_risk_levels","zero long stop gap accepted");
  });
  test("BDD35 空單止損等於進場上緣應拒絕",()=>{
    assert(signal("#SOL 掛單 99-101附近空 止損 101").reason==="invalid_risk_levels","zero short stop gap accepted");
  });
  test("BDD36 進場價上下界自動排序",()=>{
    const x=signal("#BTC 掛單 80000-79000附近多 止損 78000");
    assert(x.reason==="ok" && x.low===79000 && x.high===80000,"reverse range not normalized");
  });
  test("BDD37 單一市價也能作為進場價格",()=>{
    const x=signal("#BTC 市價 78500附近多 止損 77200");
    assert(x.reason==="ok" && x.low===78500 && x.high===78500,"single entry failed");
  });
  test("BDD38 止盈目標價可被解析",()=>{
    const x=signal("#SOL 市價 99-101附近多 止損 95 止盈 120");
    assert(x.reason==="ok" && x.target===120,"take profit target missing");
  });
  test("BDD39 進場價格缺失應拒絕",()=>{
    assert(signal("#SOL 市價附近多 止損 95").reason==="entry_missing","missing entry accepted");
  });
  test("BDD40 空文字不產生交易",()=>{
    assert(signal("   ").reason==="not_trade_signal","blank signal accepted");
  });
  test("BDD41 Telegram HTML 重複貼文 ID 只讀一次",()=>{
    const html='<div data-post="KCryptoBTC168/5010"><div class="tgme_widget_message_text js-message_text">A</div></div>'+
      '<div data-post="KCryptoBTC168/5010"><div class="tgme_widget_message_text js-message_text">B</div></div>';
    const x=parseChannel(html);
    assert(x.length===1 && x[0].id===5010,"duplicate channel item");
  });
  test("BDD42 HTML entity 不應損壞訊號文字",()=>{
    assert(plain("#BTC &amp; SOL<br>止損 &lt; 80")==="#BTC & SOL\n止損 < 80","entity/br decoder broken");
  });
  test("BDD43 引用的原訊號文字不應覆寫回覆正文",()=>{
    const h='<div data-post="KCryptoBTC168/5002"><a class="tgme_widget_message_reply" href="https://t.me/KCryptoBTC168/5001">'+
      '<div class="tgme_widget_message_text js-message_reply_text">#SOL 市價 99-101附近多 止損 95</div></a>'+
      '<div class="tgme_widget_message_text js-message_text">減倉</div><time datetime="'+current()+'"></time></div>';
    const x=parseChannel(h);
    assert(x.length===1 && x[0].text==="減倉" && x[0].replyTo===5001,"reply text overwritten");
  });
  test("BDD44 編輯過的 Telegram 文字保留原文",()=>{
    const m={id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:current()};
    ingest([m],()=>{});ingest([{...m,text:"內容已修改"}],()=>{});
    assert(state.messages.length===1 && state.messages[0].text===m.text &&
      state.messages[0].latestText==="內容已修改","original edit was lost");
  });
  test("BDD45 晚到的舊訊息不可倒補成交",()=>{
    state.lastSeenId=5020;
    ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:current()}],()=>{});
    assert(state.orders.length===0 && state.messages[0].classification==="late_history_ignored","backfilled a past order");
  });
  test("BDD46 超過容許時鐘誤差的未來訊息拒絕",()=>{
    ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",
      publishedAt:new Date(Date.now()+180000).toISOString()}],()=>{});
    assert(state.orders.length===0 && state.messages[0].classification==="stale_or_missing_timestamp","future signal accepted");
  });
  test("BDD47 缺乏發布時間的訊號拒絕",()=>{
    ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:null}],()=>{});
    assert(state.orders.length===0 && state.messages[0].classification==="stale_or_missing_timestamp","undated signal accepted");
  });
  test("BDD48 發布時間在容許窗內可以成為掛單",()=>{
    ingest([{id:5001,text:"#SOL 掛單 99-101附近多 止損 95",
      publishedAt:new Date(Date.now()-AGE+10000).toISOString()}],()=>{});
    assert(state.orders.length===1 && state.orders[0].status==="pending","fresh limit rejected");
  });
  test("BDD49 找不到原單的平倉回覆須人工檢視",()=>{
    ingest([{id:5001,replyTo:4999,text:"全部平倉",publishedAt:current()}],()=>{});
    assert(state.orders.length===0 && state.messages[0].classification==="orphan_reply_needs_review","orphan close accepted");
  });
  test("BDD50 過期的減倉回覆不補成交",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    state.lastSeenId=5001;
    ingest([{id:5002,replyTo:5001,text:"減倉",publishedAt:new Date(Date.now()-AGE-1000).toISOString()}],()=>{});
    assert(o.pendingCloseCommands.length===0 && o.exitEvents.length===0,"stale close processed");
  });
  test("BDD51 同幣種不同有效訊號獨立成單",()=>{
    ingest([{id:5001,text:"#SOL 市價 99-101附近多 止損 95",publishedAt:current()},
      {id:5002,text:"#SOL 掛單 99-101附近多 止損 95",publishedAt:current()}],()=>{});
    assert(state.orders.length===2 && state.orders[0].messageId!==state.orders[1].messageId,"distinct orders collapsed");
  });
  test("BDD52 首次同步基線使用最大 ID",()=>{
    state=fresh();
    ingest([{id:5003,text:"A",publishedAt:current()},{id:5001,text:"B",publishedAt:current()}],()=>{});
    assert(state.lastSeenId===5003 && state.messages.length===2 && state.orders.length===0,"baseline watermark wrong");
  });
  test("BDD53 收到新貼文後高水位訊息 ID 前進",()=>{
    ingest([{id:5005,text:"評論",publishedAt:current()}],()=>{});
    assert(state.lastSeenId===5005 && state.messages.length===1,"watermark not advanced");
  });
  test("BDD54 不支援的品種應保留分類但不開單",()=>{
    ingest([{id:5001,text:"#XAU 市價 4000-4010附近多 止損 3900",publishedAt:current()}],()=>{});
    assert(state.orders.length===0 && state.messages[0].classification==="unsupported_market_XAU","unsupported market order created");
  });
  test("BDD55 不完整進出場敘述不自動交易",()=>{
    ingest([{id:5001,text:"#ZEC 現在不急著追多，可以先觀察",publishedAt:current()}],()=>{});
    assert(state.orders.length===0,"vague signal traded");
  });
  test("BDD56 未引用原貼文的平倉指令列為待審",()=>{
    ingest([{id:5001,text:"全部平倉",publishedAt:current(),replyTo:null}],()=>{});
    assert(state.orders.length===0 && state.messages[0].classification==="unlinked_exit_needs_review","unlinked exit traded");
  });
  test("BDD57 未成交限價單收到取消指令不得成交",()=>{
    const o=mock();state.orders=[o];state.lastSeenId=5001;
    ingest([{id:5002,text:"取消掛單",publishedAt:current(),replyTo:5001}],()=>{});
    assert(o.status==="cancelled","pending cancellation ignored");
  });
  test("BDD58 等待市價的訂單也能取消",()=>{
    const o=mock({status:"waiting_price"});state.orders=[o];state.lastSeenId=5001;
    ingest([{id:5002,text:"取消掛單",publishedAt:current(),replyTo:5001}],()=>{});
    assert(o.status==="cancelled","waiting quote cancellation ignored");
  });
  test("BDD59 已開倉收到取消掛單不可偷偷平倉",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);state.lastSeenId=5001;
    ingest([{id:5002,text:"取消掛單",publishedAt:current(),replyTo:5001}],()=>{});
    assert(o.status==="open" && o.exitEvents.length===0 &&
      state.messages[0].classification==="needs_review","cancelled an already filled order");
  });
  test("BDD60 已取消限價單即使後來觸價也不建倉",()=>{
    const o=mock({status:"cancelled"});state.orders=[o];handlePrice("SOLUSDT",100);
    assert(o.status==="cancelled" && o.qty===0,"cancelled order reopened");
  });


  // State machine, order sizing, stop/take-profit and partial close.
  test("BDD61 已過期掛單不得再次建倉",()=>{
    const o=mock({status:"expired"});state.orders=[o];handlePrice("SOLUSDT",100);
    assert(o.status==="expired" && o.qty===0,"expired order filled");
  });
  test("BDD62 已拒絕訂單不得再次開倉",()=>{
    const o=mock({status:"rejected"});state.orders=[o];handlePrice("SOLUSDT",100);
    assert(o.status==="rejected" && o.qty===0,"rejected order filled");
  });
  test("BDD63 同一筆訊號的連續收價不會重複開倉",()=>{
    const o=mock();state.orders=[o];handlePrice("SOLUSDT",100);
    const qty=o.qty,entry=o.entryTime;
    handlePrice("SOLUSDT",100);handlePrice("SOLUSDT",101);
    assert(o.status==="open" && o.qty===qty && o.entryTime===entry,"duplicate entry");
  });
  test("BDD64 舊版頻道平倉請求相容",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);o.reason="channel_close_requested";
    handlePrice("SOLUSDT",100.5);
    assert(o.status==="closed" && o.reason==="channel_close","legacy pending close lost");
  });
  test("BDD65 其他交易對的價格不可平掉 SOL",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    handlePrice("BTCUSDT",94);
    assert(o.status==="open" && o.exitEvents.length===0,"other symbol price changed SOL");
  });
  test("BDD66 空單限價區間觸價可正確進場",()=>{
    const o=mock({side:"short",stop:105});state.orders=[o];
    handlePrice("SOLUSDT",101);
    assert(o.status==="open" && o.qty>0 && o.entryPrice<101,"short entry failed");
  });
  test("BDD67 掛單價太高或太低都保持待成交",()=>{
    const o=mock();state.orders=[o];
    handlePrice("SOLUSDT",98);assert(o.status==="pending","low outside range filled");
    handlePrice("SOLUSDT",102);assert(o.status==="pending","high outside range filled");
  });
  test("BDD68 掛單區間下緣是有效觸價",()=>{
    const o=mock();state.orders=[o];handlePrice("SOLUSDT",99);
    assert(o.status==="open","lower boundary rejected");
  });
  test("BDD69 掛單區間上緣是有效觸價",()=>{
    const o=mock();state.orders=[o];handlePrice("SOLUSDT",101);
    assert(o.status==="open","upper boundary rejected");
  });
  test("BDD70 進場報價 NaN/零/負數一律不能成交",()=>{
    for (const price of [NaN,0,-1,Infinity]) {
      const o=mock();state.orders=[o];handlePrice("SOLUSDT",price);
      assert(o.status==="pending" && !o.qty,"invalid quote filled: "+price);
    }
  });
  test("BDD71 直接開倉價格不合法時拒絕",()=>{
    const o=mock();state.orders=[o];openOrder(o,0);
    assert(o.status==="rejected" && o.qty===0,"zero entry accepted");
  });
  test("BDD72 止損先於頻道減倉命令執行",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    o.pendingCloseCommands.push({messageId:5002,fraction:0.5,reason:"channel_partial_take_profit"});
    handlePrice("SOLUSDT",94);
    assert(o.status==="closed" && o.reason==="stop_loss" && o.exitEvents.length===1,"stop was bypassed");
  });
  test("BDD73 既定 TP 觸發時不得再重複頻道平倉",()=>{
    const o=mock({target:110});state.orders=[o];openOrder(o,100);
    o.pendingCloseCommands.push({messageId:5002,fraction:1,reason:"channel_close"});
    handlePrice("SOLUSDT",111);
    assert(o.status==="closed" && o.reason==="take_profit" && o.exitEvents.length===1,"double close with TP");
  });
  test("BDD74 一筆兩個不同減倉回覆依序各減半",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);const initial=o.qty;
    o.pendingCloseCommands=[{messageId:5002,fraction:0.5,reason:"partial"},
      {messageId:5003,fraction:0.5,reason:"partial"}];
    handlePrice("SOLUSDT",100.5);
    assert(o.status==="open" && o.exitEvents.length===2,"partial command count wrong");
    near(o.qty,initial*0.25);
  });
  test("BDD75 已執行過的減倉命令不再重播",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"partial",0.5,5002);
    const remaining=o.qty;
    handlePrice("SOLUSDT",100.5);
    near(o.qty,remaining);
    assert(o.exitEvents.length===1,"partial exit replayed");
  });
  test("BDD76 平倉比例 0 不得改變帳本",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);const q=o.qty;
    closeOrder(o,110,"partial",0,5002);
    assert(o.status==="open" && o.qty===q && o.exitEvents.length===0,"zero fraction exited");
  });
  test("BDD77 平倉數量不可超過現有倉位",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"channel_close",2);
    assert(o.status==="closed" && o.qty===0 && o.exitEvents.length===1 &&
      o.exitEvents[0].qty<=o.initialQty,"overclosed negative quantity");
  });
  test("BDD78 已完成平倉不可重複結算",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"take_profit");const pnl=o.netPnl;
    closeOrder(o,200,"take_profit");
    assert(o.exitEvents.length===1 && o.netPnl===pnl,"closed position double-settled");
  });
  test("BDD79 停損不能讓已平倉的單再次出場",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"take_profit");handlePrice("SOLUSDT",50);
    assert(o.status==="closed" && o.exitEvents.length===1,"closed position stopped again");
  });
  test("BDD80 空單獲利方向正確",()=>{
    const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
    closeOrder(o,90,"take_profit");
    assert(o.netPnl>0 && o.grossPnl>0,"profitable short scored as loss");
  });
  test("BDD81 多筆倉位遵守單筆上限與總資金約束",()=>{
    const a=mock({id:"A",messageId:5001}),b=mock({id:"B",messageId:5002});
    state.orders=[a,b];openOrder(a,100);openOrder(b,100);
    const sum=a.qty*a.entryPrice+b.qty*b.entryPrice;
    assert(a.qty*a.entryPrice<=START_BALANCE*MAX_POSITION+0.01 &&
      b.qty*b.entryPrice<=START_BALANCE*MAX_POSITION+0.01 &&
      sum<=START_BALANCE+0.01,"portfolio allocation exceeded cap");
  });
  test("BDD82 無可用淨值不得建立新倉",()=>{
    state.orders=[mock({status:"closed",qty:0,initialQty:1,netPnl:-START_BALANCE})];
    const o=mock({id:"N",messageId:5002});state.orders.push(o);openOrder(o,100);
    assert(o.status==="rejected" && o.qty===0,"opened with zero net worth");
  });
  test("BDD83 指定超過100%的減倉比例必須拒絕",()=>{
    assert(closeFraction("減倉150%")===0 && closeFraction("減倉 4/3")===0,
      "invalid fraction converted into full close");
  });
  test("BDD84 止盈百分比可判定為部分平倉",()=>{
    assert(partialMsg("止盈 30%") && closeMsg("止盈 30%"),"percentage TP not partial");
    near(closeFraction("止盈 30%"),0.3);
  });
  test("BDD85 多單入場與出場都計算不利滑價",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);closeOrder(o,110,"take_profit");
    near(o.entryPrice,100*(1+SLIP));near(o.exitPrice,110*(1-SLIP));
  });
  test("BDD86 空單入場與出場都計算不利滑價",()=>{
    const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
    closeOrder(o,90,"take_profit");
    near(o.entryPrice,100*(1-SLIP));near(o.exitPrice,90*(1+SLIP));
  });
  test("BDD87 每筆入場手續費依名目倉位計算",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    near(o.feeEntry,o.qty*o.entryPrice*FEE);
  });
  test("BDD88 每個出場腿依實際平倉名目計算手續費",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"partial",0.5,5002);closeOrder(o,115,"full");
    near(o.feeExit,o.exitEvents.reduce((v,x)=>v+x.feeExit,0));
  });
  test("BDD89 減倉後再增值，已實現損益不變",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);closeOrder(o,110,"partial",0.5,5002);
    const before=realizedOf(o);
    handlePrice("SOLUSDT",100.5);
    near(realizedOf(o),before);
  });
  test("BDD90 平倉接受無效價格必須不處理",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);const before=o.qty;
    closeOrder(o,0,"take_profit");
    closeOrder(o,NaN,"take_profit");
    assert(o.status==="open" && o.qty===before && o.exitEvents.length===0,"bad close quote accepted");
  });


  // Portfolio accounting, audit, reports, security & recovery behaviour.
  test("BDD91 無交易的績效報表維持期初資金",()=>{
    const r=report();near(r.equity,START_BALANCE);
    assert(r.closedTrades===0 && r.openPositions===0 && r.pendingOrders===0 &&
      r.realizedPnl===0 && r.unrealizedPnl===0,"empty portfolio report wrong");
  });
  test("BDD92 已完成一筆賺錢的交易勝率為100%",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);closeOrder(o,110,"take_profit");
    const r=report();assert(r.closedTrades===1 && r.winRatePct===100 && r.realizedPnl>0,"win rate wrong");
  });
  test("BDD93 一勝一敗的勝率為50%",()=>{
    const t=current();
    state.orders=[
      mock({id:"A",status:"closed",netPnl:10,exitTime:t,exitEvents:[{at:t,netPnl:10}]}),
      mock({id:"B",status:"closed",netPnl:-5,exitTime:t,exitEvents:[{at:t,netPnl:-5}]})
    ];
    const r=report();assert(r.closedTrades===2 && r.winRatePct===50,"two trades win rate wrong");
  });
  test("BDD94 盈虧因子是獲利總額除以虧損絕對值",()=>{
    const t=current();
    state.orders=[mock({status:"closed",netPnl:10,exitTime:t,exitEvents:[
      {at:t,netPnl:20},{at:t,netPnl:-10}
    ]})];
    near(report().profitFactor,2);
  });
  test("BDD95 沒有虧損時盈虧因子顯示未定義",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);closeOrder(o,110,"take_profit");
    assert(report().profitFactor===null,"profit factor should be null without losses");
  });
  test("BDD96 最大回撤按歷史淨值峰值計算",()=>{
    state.snapshots=[{at:current(),equity:10000},{at:current(),equity:11000},
      {at:current(),equity:9000}];
    near(report().maxDrawdownPct,2000/11000*100);
  });
  test("BDD97 60秒內的重複績效快照不應堆積",()=>{
    snapshot();snapshot();snapshot();
    assert(state.snapshots.length===1,"snapshot interval missing");
  });
  test("BDD98 UTC 跨日出場記入不同日期",()=>{
    const at1="2026-11-02T23:59:00Z",at2="2026-11-03T00:01:00Z";
    state.orders=[mock({status:"closed",netPnl:15,exitEvents:[
      {at:at1,netPnl:10},{at:at2,netPnl:5}
    ]})];
    const r=report();
    assert(r.daily["2026-11-02"].trades===1 && r.daily["2026-11-03"].trades===1,"UTC day split missing");
  });
  test("BDD99 UTC 跨月平倉應分開月報表",()=>{
    state.orders=[mock({status:"closed",netPnl:30,exitEvents:[
      {at:"2026-10-31T23:59:00Z",netPnl:10},{at:"2026-11-01T00:01:00Z",netPnl:20}
    ]})];
    const r=report();
    assert(r.monthly["2026-10"].pnl===10 && r.monthly["2026-11"].pnl===20,"month boundary wrong");
  });
  test("BDD100 幣種績效必須分別累計而非混淆",()=>{
    const t=current();
    state.orders=[
      mock({id:"A",symbol:"SOLUSDT",status:"closed",netPnl:8,exitEvents:[{at:t,netPnl:8}]}),
      mock({id:"B",symbol:"BTCUSDT",status:"closed",netPnl:-3,exitEvents:[{at:t,netPnl:-3}]})
    ];
    const r=report();
    assert(r.symbols.SOLUSDT.pnl===8 && r.symbols.BTCUSDT.pnl===-3,"symbols merged");
  });
  test("BDD101 報表手續費是入場與每次出場總和",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"partial",0.5,5002);
    closeOrder(o,105,"full");
    near(report().feesPaid,o.feeEntry+o.feeExit);
  });
  test("BDD102 部分平倉已實現收益要在持倉期間列報",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"partial",0.5,5002);
    assert(o.status==="open" && report().realizedPnl>0 && report().partialExits===1,
      "partial revenue missing");
  });
  test("BDD103 已平倉與持倉合計淨值不重複扣費",()=>{
    const a=mock({id:"A",messageId:5001}),b=mock({id:"B",messageId:5002});
    state.orders=[a,b];openOrder(a,100);closeOrder(a,110,"take_profit");
    openOrder(b,100);handlePrice("SOLUSDT",105);
    const r=report();
    near(r.equity,START_BALANCE+r.realizedPnl+r.unrealizedPnl);
  });
  test("BDD104 出場紀錄在已平倉後仍保留",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"partial",0.5,5002);
    closeOrder(o,115,"full",1,5003);
    assert(o.status==="closed" && o.exitEvents.length===2 &&
      o.exitEvents[0].messageId===5002 && o.exitEvents[1].messageId===5003,"exit audit trail lost");
  });
  test("BDD105 掛單本身不影響淨值",()=>{
    state.orders=[mock(),mock({id:"B",messageId:5002,status:"waiting_price"})];
    assert(equity()===START_BALANCE && report().realizedPnl===0,"unfilled order affected equity");
  });
  test("BDD106 已撤銷掛單不產生手續費",()=>{
    state.orders=[mock({status:"cancelled"})];
    assert(report().feesPaid===0 && report().realizedPnl===0,"cancelled order charged fee");
  });
  test("BDD107 已平倉紀錄不因後續行情變動改變",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"take_profit");const before=o.netPnl;
    handlePrice("SOLUSDT",80);
    near(o.netPnl,before);near(equity(),START_BALANCE+before);
  });
  test("BDD108 CSV 匯出含交易關聯和結算欄位",()=>{
    const content=csv();
    assert(content.startsWith("messageId,symbol,side,kind,status") &&
      content.includes("netPnl") && content.includes("exitEvents"),"CSV fields incomplete");
  });
  test("BDD109 CSV 內的引號須跳脫，不得破壞列結構",()=>{
    state.orders=[mock({reason:'alert "incorrect" text'})];
    const content=csv();
    assert(content.includes('""incorrect""') && content.split("\n").length===2,"CSV quote escape failed");
  });
  test("BDD110 CSV 每筆單必須帶 Telegram 原始連結",()=>{
    state.orders=[mock()];
    assert(csv().includes("https://t.me/KCryptoBTC168/5001"),"original channel link missing");
  });
  test("BDD111 CSV 必須包含分批出場明細 JSON",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"partial",0.5,5002);
    assert(csv().includes("fractionOfRemaining") && csv().includes("5002"),"partial exits missing from export");
  });
  test("BDD112 健康檢查無密碼也能驗證存活",()=>{
    const r=route(new Request("http://localhost/healthz"));
    assert(r.status===200 && r.headers.get("Cache-Control")==="no-store","health endpoint not healthy");
  });
  test("BDD113 未登入不可存取儀表板或自我測試",()=>{
    for(const path of ["/","/api/report","/api/selftest","/api/orders","/api/orders.csv"]){
      assert(route(new Request("http://localhost"+path)).status===401,"unauthorized: "+path);
    }
  });
  test("BDD114 格式錯誤的 Basic Authorization 必須拒絕",()=>{
    const r=route(new Request("http://localhost/api/report",{headers:{Authorization:"Basic invalidbase64%%%"} }));
    assert(r.status===401,"malformed Basic was accepted");
  });
  test("BDD115 密碼錯誤的 API 請求須拒絕",()=>{
    const h="Basic "+btoa("viewer:not-the-secret");
    assert(route(new Request("http://localhost/api/report",{headers:{Authorization:h}})).status===401,
      "wrong password allowed");
  });
  test("BDD116 有效密碼可存取績效 API",()=>{
    const h="Basic "+btoa("viewer:"+password);
    assert(route(new Request("http://localhost/api/report",{headers:{Authorization:h}})).status===200,
      "authenticated report inaccessible");
  });
  test("BDD117 非 GET HTTP 操作應拒絕",()=>{
    const h="Basic "+btoa("viewer:"+password);
    assert(route(new Request("http://localhost/api/report",{method:"POST",headers:{Authorization:h}})).status===405,
      "POST accepted on read-only API");
  });
  test("BDD118 無效 API 路徑回覆404",()=>{
    const h="Basic "+btoa("viewer:"+password);
    assert(route(new Request("http://localhost/api/unknown",{headers:{Authorization:h}})).status===404,
      "unknown API route did not 404");
  });
  test("BDD119 報告 API 內容型別應為 JSON",()=>{
    const h="Basic "+btoa("viewer:"+password);
    const r=route(new Request("http://localhost/api/report",{headers:{Authorization:h}}));
    assert(r.status===200 && (r.headers.get("Content-Type")||"").includes("application/json"),
      "report content type wrong");
  });
  test("BDD120 交易匯出 API 應標示 CSV 和附件名稱",()=>{
    const h="Basic "+btoa("viewer:"+password);
    const r=route(new Request("http://localhost/api/orders.csv",{headers:{Authorization:h}}));
    assert(r.status===200 && (r.headers.get("Content-Type")||"").includes("text/csv") &&
      (r.headers.get("Content-Disposition")||"").includes("filename="),"CSV download headers missing");
  });
  test("BDD121 不得因路徑包含 selftest 就略過權限檢查",()=>{
    assert(route(new Request("http://localhost/api/selftest?debug=1")).status===401,
      "selftest auth bypass");
  });
  test("BDD122 績效 API 禁止 HTTP 快取以防資料外洩",()=>{
    const h="Basic "+btoa("viewer:"+password);
    const r=route(new Request("http://localhost/api/report",{headers:{Authorization:h}}));
    assert(r.headers.get("Cache-Control")==="no-store","sensitive report cached");
  });
  test("BDD123 每次正確行情更新報價時間與數值",()=>{
    handlePrice("SOLUSDT",123.456);
    assert(state.quotes.SOLUSDT?.price===123.456 &&
      !isNaN(Date.parse(state.quotes.SOLUSDT?.at)), "quote timestamp missing");
  });
  test("BDD124 模擬交易 JSON 序列化還原保留減倉紀錄",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,110,"partial",0.5,5002,true);
    const saved=JSON.stringify(state);
    const restored=JSON.parse(saved),x=restored.orders[0];
    assert(x.status==="open" && x.exitEvents.length===1 && x.exitEvents[0].messageId===5002 &&
      x.qty>0 && x.qty<x.initialQty,"partial order lost on restart");
  });
  test("BDD125 合成訊號可抑制寫入正式資料",()=>{
    let writes=0;
    ingest([{id:5001,text:"#SOL 掛單 99-101附近多 止損 95",publishedAt:current()}],
      ()=>{ writes++; });
    assert(writes===1 && state.orders.length===1,"mock persistence callback not applied");
  });


  test("BDD126 淨獲利1%止盈以進場名目金額為基準",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    const threshold=onePctNetTargetMark(o);
    assert(threshold>o.entryPrice*1.01,"long net threshold must cover fees");
    const delta=projectedNetReturn(o,threshold);
    near(delta,0.01,1e-10);
  });
  test("BDD127 多單標記價僅升1%扣費後不足不得平倉",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",o.entryPrice*1.01);
    assert(o.status==="open" && projectedNetReturn(o,o.entryPrice*1.01)<0.01,
      "closed on gross 1 percent without fees");
  });
  test("BDD128 多單扣費後達淨利1%自動全部止盈",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    const mark=onePctNetTargetMark(o)*1.00001;
    handlePrice("SOLUSDT",mark);
    assert(o.status==="closed" && o.reason==="net_take_profit_1pct" && o.qty===0,
      "long net TP not closed");
    assert(o.netPnl>=o.initialQty*o.entryPrice*NET_TAKE_PROFIT,
      "long realized net gain below 1 percent");
  });
  test("BDD129 空單扣費後達淨利1%自動平倉",()=>{
    const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
    const mark=onePctNetTargetMark(o)*0.99999;
    assert(mark<o.entryPrice*0.99,"short target should account for costs");
    handlePrice("SOLUSDT",mark);
    assert(o.status==="closed" && o.reason==="net_take_profit_1pct" &&
      o.netPnl>=o.initialQty*o.entryPrice*NET_TAKE_PROFIT,
      "short net TP missed");
  });
  test("BDD130 空單標記價跌1%但扣費不足時繼續持倉",()=>{
    const o=mock({side:"short",stop:105});state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",o.entryPrice*0.99);
    assert(o.status==="open" && projectedNetReturn(o,o.entryPrice*0.99)<0.01,
      "short gross 1 percent closed early");
  });
  test("BDD131 低於1%時原有硬止損仍然優先執行",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",94);
    assert(o.status==="closed" && o.reason==="stop_loss" && o.netPnl<0,"stop ignored");
  });
  test("BDD132 Telegram 自訂較低止盈價不能繞過淨利門檻",()=>{
    const o=mock({target:100.5});state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",100.5);
    assert(o.status==="open","explicit TP below 1 percent closed");
    handlePrice("SOLUSDT",onePctNetTargetMark(o)*1.00001);
    assert(o.status==="closed" && o.netPnl>=o.initialQty*o.entryPrice*NET_TAKE_PROFIT,
      "net TP after lower target failed");
  });
  test("BDD133 Telegram 自訂較高止盈價不能延後淨利1%的自動全平",()=>{
    const o=mock({target:150});state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",onePctNetTargetMark(o)*1.00001);
    assert(o.status==="closed" && o.reason==="net_take_profit_1pct" &&
      o.exitPrice<150,"high channel target prevented 1 percent TP");
  });
  test("BDD134 減倉後剩餘數量仍以扣費淨利1%止盈",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,101,"channel_partial_take_profit",0.5,5002,true);
    assert(o.status==="open" && o.qty>0,"partial exit should remain open");
    const remaining=o.qty, projected=onePctNetTargetMark(o)*1.00001;
    handlePrice("SOLUSDT",projected);
    assert(o.status==="closed" && o.exitEvents.length===2 &&
      o.exitEvents[1].qty===remaining &&
      o.exitEvents[1].netPnl>=remaining*o.entryPrice*NET_TAKE_PROFIT,"remaining net TP wrong");
  });
  test("BDD135 交易未建倉時不得計算可平倉淨獲利",()=>{
    const o=mock();state.orders=[o];
    assert(projectedNetReturn(o,101)===null && onePctNetTargetMark(o)===null,"unopened order has net TP");
  });
  test("BDD136 無效行情不可讓1%止盈函數產生誤判",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    for(const px of [0,-1,NaN,Infinity]){
      assert(projectedNetReturn(o,px)===null,"invalid net TP projection "+px);
      handlePrice("SOLUSDT",px);
    }
    assert(o.status==="open","invalid quote triggered close");
  });
  test("BDD137 +1%自動止盈後後續價格不能重複平倉",()=>{
    const o=mock();state.orders=[o];openOrder(o,100);
    const mark=onePctNetTargetMark(o)*1.00001;
    handlePrice("SOLUSDT",mark);
    const pnl=o.netPnl;
    handlePrice("SOLUSDT",mark*2);
    assert(o.status==="closed" && o.exitEvents.length===1 && o.netPnl===pnl,
      "auto net TP double settled");
  });


  test("BDD138 Telegram 無私聊配對不能生成推播",()=>{
    state.orders=[mock({id:"A",messageId:5501})];
    queueNotice("test:unpaired","must not send");
    assert((state.notifications||[]).length===0,"unpaired target queued a message");
  });
  test("BDD139 已配對新訊號應新增一則訊息",()=>{
    state.telegram.chatId="123456789";
    ingest([{id:5001,text:"#SOL 掛單 99-101附近多 止損 95",publishedAt:current()}],()=>{});
    assert(state.notifications.length===1 && state.notifications[0].key==="signal:5001","new signal notice missing");
  });
  test("BDD140 同一 Telegram 訊號輪詢兩次不可重複推播",()=>{
    state.telegram.chatId="123456789";
    const msg={id:5001,text:"#SOL 掛單 99-101附近多 止損 95",publishedAt:current()};
    ingest([msg],()=>{});ingest([msg],()=>{});
    assert(state.notifications.length===1,"duplicate signal alert");
  });
  test("BDD141 模擬成交必須通知實際開倉價",()=>{
    state.telegram.chatId="123456789";const o=mock();state.orders=[o];
    handlePrice("SOLUSDT",100);
    assert(o.status==="open" && state.notifications.some(n=>n.key==="open:5001" && n.text.includes("成交價")),"entry alert missing");
  });
  test("BDD142 模擬止損通知有結算淨損益",()=>{
    state.telegram.chatId="123456789";const o=mock();state.orders=[o];openOrder(o,100);
    handlePrice("SOLUSDT",94);
    assert(state.notifications.some(n=>n.key==="exit:5001:1" && n.text.includes("已實現淨損益") && n.text.includes("模擬止損")),"stop alert missing");
  });
  test("BDD143 淨利1%自動止盈通知去重",()=>{
    state.telegram.chatId="123456789";const o=mock();state.orders=[o];openOrder(o,100);
    const x=onePctNetTargetMark(o)*1.00001;
    handlePrice("SOLUSDT",x);handlePrice("SOLUSDT",x*1.01);
    assert(state.notifications.filter(n=>n.key==="exit:5001:1").length===1 &&
      state.notifications.some(n=>n.text.includes("淨利 1% 自動止盈")),"net TP notification duplicate/missing");
  });
  test("BDD144 頻道減倉與最終出場各有唯一事件 ID",()=>{
    state.telegram.chatId="123456789";const o=mock();state.orders=[o];openOrder(o,100);
    closeOrder(o,100.5,"channel_partial_take_profit",0.5,5002,true);
    closeOrder(o,110,"net_take_profit_1pct");
    assert(state.notifications.filter(n=>n.key.startsWith("exit:5001:")).length===2 &&
      state.notifications.some(n=>n.key==="exit:5001:2"),"partial/full exit event identity wrong");
  });
  test("BDD145 一般行情輪詢不得產生大量價格通知",()=>{
    state.telegram.chatId="123456789";const o=mock({status:"pending"});state.orders=[o];
    for(let n=0;n<10;n++)handlePrice("SOLUSDT",120);
    assert(state.notifications.length===0,"quote tick spammed Telegram");
  });
  test("BDD146 不正確配對帳號即使拿到配對碼也要拒絕",()=>{
    state.telegram.pairingCode="0123456789abcdef0123456789abcdef";
    assert(!pairingMatches({from:{username:"someoneelse"},chat:{type:"private"},text:"/start "+state.telegram.pairingCode},state.telegram),
      "wrong username paired");
  });
  test("BDD147 正確個人帳號與一次性代碼才能配對",()=>{
    state.telegram.pairingCode="0123456789abcdef0123456789abcdef";
    assert(pairingMatches({from:{username:TG_TARGET},chat:{type:"private"},text:"/start "+state.telegram.pairingCode},state.telegram),
      "valid pairing failed");
    assert(!pairingMatches({from:{username:TG_TARGET},chat:{type:"group"},text:"/start "+state.telegram.pairingCode},state.telegram),
      "group chat paired");
  });
  test("BDD148 Telegram 推播管理 API 不可匿名查看",()=>{
    assert(route(new Request("http://localhost/api/telegram/status")).status===401 &&
      route(new Request("http://localhost/api/telegram/setup")).status===401,
      "telegram binding endpoints not protected");
  });
  test("BDD149 Telegram 待發事件經 JSON 重啟仍保留去重鍵",()=>{
    state.telegram.chatId="123456789";
    queueNotice("exit:5001:1","test persistence");
    const restored=JSON.parse(JSON.stringify(state));
    assert(restored.notifications.length===1 && restored.notifications[0].key==="exit:5001:1","outbox not persistent");
  });

  test("BDD150 Bot 入站檢查成功不得清除出站失敗或誤報恢復",()=>{
    const t=tgState();
    t.chatId="123456"; t.error="sendMessage HTTP 503";t.pollError="getUpdates timeout";
    state.notifications=[];
    confirmInboundTelegramHealthy(t);
    assert(t.pollError===null && t.error==="sendMessage HTTP 503" &&
      state.notifications.length===0,"inbound check cleared outbound failure or emitted false recovery");
  });

  test("BDD151 啟動時使用的無來源訊號假平倉不得送 Telegram",()=>{
    state.telegram.chatId="123456";
    const fake = mock({ messageId:undefined, id:"BOOT_TEST" });
    state.orders=[fake];
    openOrder(fake,100);
    closeOrder(fake,110,"take_profit");
    assert(state.notifications.length===0,"synthetic startup trade leaked into Telegram outbox");
  });


  test("BDD152 啟動自測期間即使有有效模擬 ID 也不准對外推播",()=>{
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
".card label{display:block;color:#9eaed0;font-size:12px;margin-bottom:10px}.value{font-size:27px;font-weight:740;letter-spacing:-1px}.sub{color:#8a9bbf;font-size:12px;margin-top:7px}",
".positive{color:#58d5ae}.negative{color:#ff879a}.section{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:26px 0 12px}h2{font-size:17px;margin:0}",
".panel{overflow:auto}table{width:100%;border-collapse:collapse;min-width:760px;font-size:13px;text-align:left}",
"th{font-size:11px;color:#8fa2c6;text-transform:uppercase;letter-spacing:.08em}td,th{padding:12px 11px;border-bottom:1px solid #25314b;white-space:nowrap}",
"a{color:#7eb5ff;text-decoration:none}a:hover{text-decoration:underline}.tag{padding:4px 7px;border-radius:6px;background:#27314a;font-size:11px}",
".chart{width:100%;height:210px;display:block}footer{color:#8193b5;font-size:12px;line-height:1.7;margin-top:26px}",
".status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#9fb2d8}",
".dot{width:8px;height:8px;border-radius:50%;background:#50d4a7;display:inline-block}",
"@media(max-width:760px){.cards{grid-template-columns:repeat(2,1fr)}.value{font-size:23px}.wrap{padding:20px 12px}h1{font-size:22px}}",
"</style></head><body><div class='wrap'>",
"<header><div><h1>K Signal Paper Lab</h1><small>Telegram 訊號監控 · Binance 標記價格 · 模擬交易績效</small></div><span class='pill'>● PAPER ONLY — 非真實下單</span></header>",
"<div class='warning'>本系統只模擬，無任何真實交易；持倉在扣除雙向手續費（單邊 0.04%）及模擬滑價（單邊 0.02%）後，剩餘倉位淨獲利達進場名目金額的 +1% 自動全平。止損及頻道明確平倉指令仍有效；尚未計入 Funding Fee、強平與真實訂單簿深度。歷史訊號不倒填成交。</div>",
"<div class='panel' style='margin-bottom:20px'><h2>Telegram 即時推播 — @twjavaleon</h2><p class='muted' id='tgStatus' style='font-size:13px'>檢查配對狀態中...</p><a id='tgPair' style='display:none' target='_blank' rel='noopener noreferrer'>開啟 Telegram Bot 完成配對</a></div>",
"<div class='status' id='status'>● 連線檢查中...</div>",
"<div class='cards'>",
"<div class='card'><label>模擬淨值</label><div class='value' id='equity'>—</div><div class='sub'>期初 10,000 USDT</div></div>",
"<div class='card'><label>總報酬率</label><div class='value' id='return'>—</div><div class='sub' id='realized'>已實現 —</div></div>",
"<div class='card'><label>已平倉 / 勝率</label><div class='value' id='win'>—</div><div class='sub' id='pf'>盈虧因子 —</div></div>",
"<div class='card'><label>最大回撤</label><div class='value' id='dd'>—</div><div class='sub' id='orders'>持倉與掛單 —</div></div>",
"</div><div class='section'><h2>資金曲線</h2><small>每分鐘快照，僅代表觀察到的報價</small></div>",
"<div class='panel'><svg class='chart' id='chart' viewBox='0 0 900 210' preserveAspectRatio='none'></svg></div>",
"<div class='section'><h2>模擬交易紀錄</h2><a href='/api/orders.csv' target='_blank'>匯出 CSV</a></div>",
"<div class='panel'><table><thead><tr><th>原始訊號</th><th>幣種</th><th>方向</th><th>狀態</th><th>進場區間</th><th>進場 / 出場</th><th>淨損益</th></tr></thead><tbody id='trades'><tr><td colspan='7'>載入中...</td></tr></tbody></table></div>",
"<div class='section'><h2>每日損益</h2><small>UTC 日期</small></div>",
"<div class='panel'><table><thead><tr><th>日期</th><th>交易數</th><th>勝場</th><th>已實現損益</th></tr></thead><tbody id='daily'><tr><td colspan='4'>尚無已平倉交易</td></tr></tbody></table></div>",
"<footer>來源：<a href='https://t.me/KCryptoBTC168' target='_blank'>KCryptoBTC168</a> 公開預覽 · 記錄不可代表頻道長期實盤績效 · 市價/掛單填單僅按 15 秒輪詢中實際取得的 Binance 標記價格判斷 · 無槓桿或真實下單。</footer>",
"</div><script>",
"const $=id=>document.getElementById(id);",
"const fmt=(n,d=2)=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});",
"const pnl=n=>'<span class=\"'+(n>=0?'positive':'negative')+'\">'+(n>=0?'+':'')+fmt(n)+'</span>';",
"const clean=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));",
"async function tick(){try{",
"const [r,o,s]=await Promise.all(['/api/report','/api/orders','/api/status'].map(u=>fetch(u).then(x=>x.json())));",
"$('equity').textContent=fmt(r.equity)+' USDT';$('return').innerHTML=pnl(r.netReturnPct)+'%';",
"$('realized').textContent='已實現 '+fmt(r.realizedPnl)+' USDT';",
"$('win').textContent=r.closedTrades+' / '+fmt(r.winRatePct,1)+'%';",
"$('pf').textContent='盈虧因子 '+(r.profitFactor==null?'—':fmt(r.profitFactor));",
"$('dd').textContent=fmt(r.maxDrawdownPct)+'%';",
"$('orders').textContent='持倉 '+r.openPositions+' / 掛單 '+r.pendingOrders+' / 部分平倉 '+(r.partialExits||0);",
"$('status').textContent='● 訊號：'+(s.channelError?'讀取異常':'正常')+' | 首次建立基線：'+(s.initialized?'完成':'等待中')+' | 最後訊號輪詢 '+(s.lastChannelPollAt||'—')+' | 已記錄貼文 '+s.messagesCaptured+' | 最後行情 '+(s.lastPricePollAt||'—')+(s.channelError?' | '+s.channelError:'')+(s.priceError?' | 行情錯誤：'+s.priceError:'');",
"$('trades').innerHTML=o.length?o.slice().reverse().slice(0,100).map(x=>'<tr><td><a href=\"https://t.me/KCryptoBTC168/'+x.messageId+'\" target=\"_blank\">#'+x.messageId+'</a></td><td>'+clean(x.symbol)+'</td><td>'+clean(x.side)+'</td><td><span class=\"tag\">'+clean(x.status)+'</span></td><td>'+fmt(x.entryLow)+' – '+fmt(x.entryHigh)+'</td><td>'+(x.entryPrice?fmt(x.entryPrice):'—')+' / '+(x.exitPrice?fmt(x.exitPrice):'—')+'</td><td>'+((x.status==='closed')?pnl(x.netPnl):'—')+'</td></tr>').join(''):'<tr><td colspan=\"7\">目前沒有有效的新交易訊號；不倒填歷史成交。</td></tr>';",
"const days=Object.entries(r.daily).sort((a,b)=>b[0].localeCompare(a[0]));",
"$('daily').innerHTML=days.length?days.map(([k,v])=>'<tr><td>'+k+'</td><td>'+v.trades+'</td><td>'+v.wins+'</td><td>'+pnl(v.pnl)+'</td></tr>').join(''):'<tr><td colspan=\"4\">尚無已平倉交易</td></tr>';",
"const points=r.snapshots.length?r.snapshots.map(v=>v.equity):[10000];",
"const low=Math.min(...points)-1,high=Math.max(...points)+1,span=Math.max(2,high-low);",
"let poly=points.map((v,i)=>(points.length===1?0:i/(points.length-1)*900).toFixed(2)+','+(195-(v-low)/span*175).toFixed(2)).join(' ');",
"$('chart').innerHTML='<line x1=\"0\" y1=\"195\" x2=\"900\" y2=\"195\" stroke=\"#3a4969\"/><polyline points=\"'+poly+'\" fill=\"none\" stroke=\"#62d6b6\" stroke-width=\"2.5\" vector-effect=\"non-scaling-stroke\"/>';",
"}catch(e){$('status').textContent='● 儀表板讀取失敗：'+e.message}}",
"tick();setInterval(tick,30000);",
"async function tgPanel(){try{const s=await fetch('/api/telegram/status').then(x=>x.json());const el=$('tgStatus');const a=$('tgPair');a.style.display='none';if(s.paired){el.textContent='已綁定 '+s.targetUsername+' · 已成功推播 '+s.delivered+' 則 · 待送 '+s.queued+' 則'+(s.lastError?' · 錯誤：'+s.lastError:'');return;}if(!s.botTokenConfigured){el.textContent='尚未完成配對。請先用 @BotFather 建立專用 Bot，將權杖放入 Railway 服務 Variables 的 TELEGRAM_BOT_TOKEN，勿貼在聊天中。';return;}const setup=await fetch('/api/telegram/setup').then(x=>x.json());el.textContent=setup.readyToPair?'請以 '+setup.targetUsername+' 開啟以下連結，按「Start」完成一對一安全綁定。':'Bot 已設定，正在讀取 Bot 名稱，請稍後重新整理。';if(setup.startUrl){a.href=setup.startUrl;a.style.display='inline';}}catch(err){$('tgStatus').textContent='Telegram 配對狀態讀取失敗：'+err.message;}}",
"tgPanel();setInterval(tgPanel,25000);",
"</script></body></html>"
].join("\n");
function route(req) {
  const u = new URL(req.url);
  if (u.pathname === "/healthz") return json({ ok: true, mode: "paper_only", app: "k-signal-paper-lab" });
  if (!authOk(req)) return new Response("Login required", {
    status: 401, headers: { "WWW-Authenticate": 'Basic realm="K Signal Paper Lab"',
      "Cache-Control": "no-store", "Content-Type": "text/plain" }
  });
  if (u.pathname === "/" && req.method === "GET")
    return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  if (u.pathname === "/api/status") return json({
    mode: "PAPER_ONLY", channel: "KCryptoBTC168", initialized: state.initialized,
    lastSeenId: state.lastSeenId, lastChannelPollAt: state.lastChannelPollAt,
    lastPricePollAt: state.lastPricePollAt, channelError: state.channelError,
    priceError: state.priceError, messagesCaptured: state.messages.length,
    ordersTracked: state.orders.length
  });
  if (u.pathname === "/api/telegram/status") return json(telegramStatus());
  if (u.pathname === "/api/telegram/setup") return json(telegramSetup());
  if (u.pathname === "/api/selftest" && req.method === "GET") return json(runBDDTests());
  if (u.pathname === "/api/report") return json(report());
  if (u.pathname === "/api/orders") return json(state.orders);
  if (u.pathname === "/api/messages") return json(state.messages.slice(-100).reverse());
  if (u.pathname === "/api/quotes") return json(state.quotes);
  if (u.pathname === "/api/orders.csv") return new Response(csv(), {
    headers: { "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="k_signal_paper_trades.csv"',
      "Cache-Control": "no-store" }
  });
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
