const by = (id) => document.getElementById(id);
const signed = (n) => (n > 0 ? "+" : "") + Number(n).toFixed(2);

function renderAccountSummary(id, entries, capital) {
  const total = entries.reduce((sum, [, pair]) => sum + pair[id].equity, 0);
  const trades = entries.reduce((sum, [, pair]) => sum + pair[id].trades, 0);
  const open = entries.reduce((sum, [, pair]) => sum + (pair[id].qty > 0 ? 1 : 0), 0);
  const pnl = total - capital;
  by(id + "Pnl").textContent = signed(pnl) + " USDT";
  by(id + "Pnl").className = "pnl " + (pnl > 0 ? "positive" : pnl < 0 ? "negative" : "");
  by(id + "Return").textContent = "模擬報酬 " + signed(pnl / capital * 100) + "%";
  by(id + "Detail").textContent = "資產 $" + total.toFixed(2) + " · 已平倉 " + trades + " 筆 · 持倉 " + open + " 幣";
  return { total, pnl, trades };
}

function coinCard(name, pair) {
  const card = document.createElement("article");
  const header = document.createElement("h2");
  header.textContent = name;
  card.appendChild(header);

  const price = document.createElement("div");
  price.className = "price";
  price.textContent = "$" + Number(pair.quote).toFixed(2);
  card.appendChild(price);

  const detail = document.createElement("p");
  detail.className = "mini";
  const close = Number(pair.last_close);
  const threshold = Number(pair.donchian_20_high);
  const ema = Number(pair.ema_200);
  detail.textContent =
    "最新 4h 收盤 $" + close.toFixed(2) +
    " · 20 根突破價 $" + threshold.toFixed(2) +
    " · EMA200 $" + ema.toFixed(2) +
    " · 距離突破 " + Number(pair.distance_to_breakout_pct).toFixed(2) + "%" +
    " · ATR " + Number(pair.atr_pct).toFixed(2) + "%" +
    " · " + pair.reason_no_trade +
    " · 下一根收盤 " + pair.next_close_utc;
  card.appendChild(detail);

  const grid = document.createElement("div");
  grid.className = "pair";
  for (const variant of ["a", "b"]) {
    const account = pair[variant];
    const pane = document.createElement("div");
    const title = document.createElement("b");
    title.textContent = variant.toUpperCase() + " 策略";
    pane.appendChild(title);
    const stat = document.createElement("p");
    stat.textContent = "損益 " + signed(account.equity - 1000) + " USDT";
    pane.appendChild(stat);
    const info = document.createElement("div");
    info.className = "mini";
    info.textContent = "資產 $" + Number(account.equity).toFixed(2) +
      " · 開倉 " + account.buys + " 次 · 已平倉 " + account.trades +
      " 筆 · 回撤 " + (Number(account.max_dd) * 100).toFixed(2) + "%";
    pane.appendChild(info);
    grid.appendChild(pane);
  }
  card.appendChild(grid);
  return card;
}

function show(data) {
  const entries = Object.entries(data.pairs || {});
  if (!entries.length) throw new Error("目前沒有可比較的幣種資料");
  const initial = entries.length * 1000;
  const a = renderAccountSummary("a", entries, initial);
  const b = renderAccountSummary("b", entries, initial);
  const age = (Date.now() - Date.parse(data.updated_utc)) / 1000;
  const stale = !Number.isFinite(age) || age > 180 || age < -45;
  by("health").className = "pill" + (stale ? " warn" : "");
  by("health").textContent = (stale ? "行情資料過期 · " : "行情資料正常 · ") + data.updated_utc;

  const anyTrade = entries.some(([, p]) =>
    p.a.buys > 0 || p.b.buys > 0 || p.a.trades > 0 || p.b.trades > 0
  );
  by("winner").textContent = !anyTrade
    ? "目前沒有進場訊號或模擬成交，不能比較 A/B 獲利能力。"
    : Math.abs(a.pnl - b.pnl) < 0.005
      ? "A/B 目前模擬績效持平，尚需更多交易樣本。"
      : (a.pnl > b.pnl ? "A" : "B") + " 暫時領先 " +
        Math.abs(a.pnl - b.pnl).toFixed(2) + " USDT（不是穩定獲利證明）";

  const output = by("coins");
  output.replaceChildren();
  for (const [sym, pair] of entries) output.appendChild(coinCard(sym, pair));
}

async function refresh() {
  try {
    if (typeof window.paperStatus !== "function") throw new Error("策略計算程式未載入");
    const state = await window.paperStatus();
    show(state);
  } catch (e) {
    by("health").className = "pill warn";
    by("health").textContent = "資料暫時不可用：" + (e?.message || "未知錯誤");
    by("winner").textContent = "沒有可靠的新資料，不應以面板上的舊值判斷是否下單。";
  }
}
refresh();
setInterval(refresh, 30000);
