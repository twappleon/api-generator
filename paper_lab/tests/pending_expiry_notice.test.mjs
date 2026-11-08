// Source-derived, offline, side-effect-free tests of Paper mark-price outage expiry.
// Run: node --test paper_lab/tests/pending_expiry_notice.test.mjs
// Only actual worker.ts pollPrices and notifyOrderStatus bodies are evaluated.
// No Bun, network calls, files writes, Telegram sends or live trading.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start !== -1 && end > start, "missing source marker: " + startMarker);
  return source.slice(start, end);
}
const pollBody = between("async function pollPrices() {", "// The anonymous dashboard");
const notificationBody = between("function notifyOrderStatus(o) {", "function notifyNewChannelItem");
const makePoll = new Function("ctx", `
  const {state,readablePaperOrders,TTL,AGE,fetchPrice,handlePrice,notifyOrderStatus,
    notifyServiceIssue,nowISO,snapshot,persist,console} = ctx;
  let pricesBusy = false;
  ${pollBody}
  return pollPrices;
`);
const makeNotifier = new Function("queueNotice","tgTradeLink", `
  ${notificationBody}
  return notifyOrderStatus;
`);
function scenario(rows) {
  const notices = [], notifiedKeys = new Set();
  const state = { orders: rows, priceError: null };
  let persisted = 0;
  const notifyOrderStatus = makeNotifier((key, text) => {
    if (notifiedKeys.has(key)) return false;
    notifiedKeys.add(key);
    notices.push({ key, text });
    return true;
  }, order => "https://t.me/KCryptoBTC168/" + order.messageId);
  const ctx = {
    state, TTL: 24 * 3600_000, AGE: 5 * 60_000,
    readablePaperOrders: () => rows.filter(row => row && typeof row === "object" && !Array.isArray(row)),
    fetchPrice: async () => { throw Error("SIMULATED_UPSTREAM_DOWN"); },
    handlePrice: () => { throw Error("unexpected successful quote"); },
    notifyOrderStatus, notifyServiceIssue: () => {},
    nowISO: () => new Date().toISOString(), snapshot: () => {},
    persist: () => { persisted++; }, console: { error: () => {} }
  };
  return { poll: makePoll(ctx), notices, state, persisted: () => persisted };
}
const ageHours = h => new Date(Date.now() - h * 3600_000).toISOString();
const order = (messageId, status, age) =>
  ({ messageId, status, symbol:"SOLUSDT", side:"long", receivedAt:ageHours(age) });

test("BDD215 pending limit TTL notifies once even when every Binance quote fails", async () => {
  const s = scenario([order(5001, "pending", 25)]);
  await s.poll();
  assert.equal(s.state.orders[0].status, "expired");
  assert.equal(s.state.orders[0].reason, "pending_ttl");
  assert.deepEqual(s.notices.map(n => n.key), ["order:5001:expired"]);
  assert.match(s.notices[0].text, /掛單到期/);
  assert.match(s.notices[0].text, /KCryptoBTC168\/5001/);
  await s.poll();
  assert.deepEqual(s.notices.map(n => n.key), ["order:5001:expired"]);
});

test("BDD216 pending unexpired order does not create a false expiry notice", async () => {
  const s = scenario([order(5002, "pending", 1)]);
  await s.poll();
  assert.equal(s.state.orders[0].status, "pending");
  assert.deepEqual(s.notices, []);
});

test("BDD217 stale market-entry rejection alert remains intact", async () => {
  const s = scenario([order(5003, "waiting_price", 1)]);
  await s.poll();
  assert.equal(s.state.orders[0].status, "rejected");
  assert.equal(s.state.orders[0].reason, "price_timeout");
  assert.deepEqual(s.notices.map(n => n.key), ["order:5003:rejected"]);
});

test("BDD218 multiple expired orders notify independently, malformed legacy rows ignored", async () => {
  const s = scenario([null, "unreadable", order(5004,"pending",25), order(5005,"pending",25)]);
  await s.poll();
  assert.deepEqual(s.notices.map(n => n.key), ["order:5004:expired","order:5005:expired"]);
  assert.equal(s.state.orders[0], null);
  assert.equal(s.state.orders[1], "unreadable");
  assert.ok(s.persisted() >= 1);
});
