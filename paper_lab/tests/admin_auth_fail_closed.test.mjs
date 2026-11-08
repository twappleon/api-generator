// Safe, source-derived management authentication regression tests.
// Run: node --test paper_lab/tests/admin_auth_fail_closed.test.mjs
// Reads source only; no HTTP request is sent, no Bun instance, no persistence or Telegram.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const source = readFileSync(new URL('../worker.ts', import.meta.url), 'utf8');
const start = source.indexOf('function authOk(req');
const end = source.indexOf('function runBDDTests()', start);
assert.ok(start >= 0 && end > start, 'missing authOk source / BDD marker');
const block = source.slice(start, end);
const build = new Function('Buffer', 'timingSafeEqual', 'atob', 'defaultPassword',
  `const password = defaultPassword; ${block}; return authOk;`);
const authOk = build(Buffer, timingSafeEqual, atob, 'SYNTHETIC_LONG_BOOT_PASSWORD_2026');
const basic = credentials => 'Basic ' + Buffer.from(credentials).toString('base64');
const request = authorization => new Request('http://localhost/api/selftest',
  { headers: authorization ? { Authorization: authorization } : {} });

test('BDD219: missing APP_PASSWORD must never authenticate blank or nonblank Basic', () => {
  assert.equal(authOk(request(basic('operator:')), ''), false);
  assert.equal(authOk(request(basic('operator:anything')), ''), false);
  assert.equal(authOk(request(basic('operator:anything')), null), false);
});

test('BDD220: configured non-empty admin password still works exactly', () => {
  assert.equal(authOk(request(basic('operator:secret')), 'secret'), true);
  assert.equal(authOk(request(basic('operator:secret')), 'wrong'), false);
  assert.equal(authOk(request(basic('operator:')), 'secret'), false);
});

test('BDD221: missing, wrong-scheme and malformed credentials stay rejected', () => {
  assert.equal(authOk(request(null), 'secret'), false);
  assert.equal(authOk(request('Bearer secret'), 'secret'), false);
  assert.equal(authOk(request('Basic !!!'), 'secret'), false);
});
