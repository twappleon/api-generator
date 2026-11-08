// Source-derived Node regression: public Telegram pairing status is a typed DTO.
// Run: node --test paper_lab/tests/public_telegram_status_projection.test.mjs
// Uses isolated synthetic metadata, not a real Telegram API or durable file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../worker.ts', import.meta.url), 'utf8');
const between = (a, b) => {
  const i = source.indexOf(a), j = source.indexOf(b, i + a.length);
  assert.ok(i >= 0 && j > i, `expected source markers ${a} -> ${b}`);
  return source.slice(i, j);
};
const projection = between('function publicTelegramStatus() {', 'function telegramSetup()');
const timeHelper = between('function publicCsvTime(value){', 'function publicCsvValue(');
const compute = new Function('telegramStatus', `${timeHelper}\n${projection}\nreturn publicTelegramStatus();`);
const baseline = { targetUsername: '@twjavaleon', paired: true, queued: 1,
  botUsername: 'Signal_Helper_Bot', delivered: 7,
  lastSentAt: '2026-11-08T09:00:00.000Z' };
const view = metadata => compute(() => ({ ...baseline, ...metadata }));

test('BDD222: corrupt historical username, timestamp and count do not leak', () => {
  const result = view({ botUsername: 'Authorization: Bearer PRIVATE_222',
    delivered: 'PRIVATE_COUNT_222', lastSentAt: 'Bearer PRIVATE_TIME_222' });
  assert.equal(result.botUsername, null);
  assert.equal(result.delivered, 0);
  assert.equal(result.lastSentAt, null);
  assert.equal(JSON.stringify(result).includes('PRIVATE_222'), false);
});

test('BDD223: legitimate pairing status and delivery statistics remain readable', () => {
  assert.deepEqual(view({}), baseline);
});

test('BDD224: corrupted counts, dates, and usernames are replaced by safe values', () => {
  const result = view({ paired: false, queued: -4, delivered: -100,
    botUsername: 'Bad?url=SECRET_224', lastSentAt: { token: 'SECRET_224' } });
  assert.equal(result.queued, 0);
  assert.equal(result.delivered, 0);
  assert.equal(result.botUsername, null);
  assert.equal(result.lastSentAt, null);
  assert.equal(JSON.stringify(result).includes('SECRET_224'), false);
});
