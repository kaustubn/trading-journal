// Security helpers: run with `npm test` (node:test + ts-node, no network, no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { verifyHmac, signHmac } from '../src/security/webhookSignature';
import { webhookUrlProblem } from '../src/security/webhookUrl';
import { passwordProblem } from '../src/security/password';
import { createLoginLimiter } from '../src/security/loginLimiter';
import { makeOwnsAccount, makeRequireAccount } from '../src/security/ownership';

// ---------- webhook signatures ----------
const SECRET = 'test-secret-not-real';
const body = Buffer.from('{"event":"trade_closed","account_id":"123"}');
const goodSig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');

test('webhook: correct HMAC is accepted', () => {
  assert.equal(verifyHmac(body, goodSig, SECRET), true);
});
test('webhook: bare hex signature (no sha256= prefix) is accepted', () => {
  assert.equal(verifyHmac(body, goodSig.slice(7), SECRET), true);
});
test('webhook: missing signature is rejected', () => {
  assert.equal(verifyHmac(body, undefined, SECRET), false);
  assert.equal(verifyHmac(body, '', SECRET), false);
});
test('webhook: wrong secret is rejected', () => {
  assert.equal(verifyHmac(body, goodSig, 'other-secret'), false);
});
test('webhook: tampered body is rejected', () => {
  const tampered = Buffer.from('{"event":"trade_closed","account_id":"124"}');
  assert.equal(verifyHmac(tampered, goodSig, SECRET), false);
});
test('webhook: no secret configured means reject everything (fail closed)', () => {
  assert.equal(verifyHmac(body, goodSig, undefined), false);
  assert.equal(verifyHmac(body, goodSig, ''), false);
});
test('webhook: missing raw body is rejected', () => {
  assert.equal(verifyHmac(undefined, goodSig, SECRET), false);
});
test('webhook: wrong-length and non-hex signatures are rejected without throwing', () => {
  assert.equal(verifyHmac(body, 'sha256=abcd', SECRET), false);
  assert.equal(verifyHmac(body, 'sha256=' + 'z'.repeat(64), SECRET), false);
});
test('webhook: signHmac round-trips with verifyHmac', () => {
  assert.equal(verifyHmac(body, signHmac(body, SECRET), SECRET), true);
});

// ---------- outgoing webhook URLs (SSRF) ----------
test('ssrf: Discord webhook URL is allowed for discord', () => {
  assert.equal(webhookUrlProblem('discord', 'https://discord.com/api/webhooks/123/abc'), null);
  assert.equal(webhookUrlProblem('discord', 'https://discordapp.com/api/webhooks/123/abc'), null);
});
test('ssrf: Telegram bot URL is allowed for telegram', () => {
  assert.equal(webhookUrlProblem('telegram', 'https://api.telegram.org/bot123:abc/sendMessage?chat_id=1'), null);
});
test('ssrf: plain http is refused', () => {
  assert.notEqual(webhookUrlProblem('discord', 'http://discord.com/api/webhooks/1/a'), null);
});
test('ssrf: internal and cloud-metadata addresses are refused', () => {
  for (const u of ['https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.5/x', 'https://[::1]/x', 'https://192.168.1.1/x']) {
    assert.notEqual(webhookUrlProblem('discord', u), null, u);
  }
});
test('ssrf: look-alike hosts are refused', () => {
  for (const u of ['https://discord.com.evil.io/api/webhooks/1/a', 'https://evildiscord.com/api/webhooks/1/a',
    'https://discord.com@evil.io/api/webhooks/1/a']) {
    assert.notEqual(webhookUrlProblem('discord', u), null, u);
  }
});
test('ssrf: credentials in URL, other ports and wrong path are refused', () => {
  assert.notEqual(webhookUrlProblem('discord', 'https://user:pw@discord.com/api/webhooks/1/a'), null);
  assert.notEqual(webhookUrlProblem('discord', 'https://discord.com:8443/api/webhooks/1/a'), null);
  assert.notEqual(webhookUrlProblem('discord', 'https://discord.com/users/@me'), null);
});
test('ssrf: unknown service, empty and garbage URLs are refused', () => {
  assert.notEqual(webhookUrlProblem('slack', 'https://hooks.slack.com/x'), null);
  assert.notEqual(webhookUrlProblem('discord', ''), null);
  assert.notEqual(webhookUrlProblem('discord', 'not a url'), null);
  assert.notEqual(webhookUrlProblem('discord', undefined as any), null);
});
test('ssrf: Telegram URL is not accepted for Discord', () => {
  assert.notEqual(webhookUrlProblem('discord', 'https://api.telegram.org/bot1:a/sendMessage'), null);
});

// ---------- password policy ----------
test('password: 10+ characters is accepted', () => {
  assert.equal(passwordProblem('correct-horse'), null);
});
test('password: short, empty and non-string passwords are refused', () => {
  assert.notEqual(passwordProblem('a'), null);
  assert.notEqual(passwordProblem('123456789'), null); // 9 chars
  assert.notEqual(passwordProblem(''), null);
  assert.notEqual(passwordProblem(undefined), null);
  assert.notEqual(passwordProblem(12345678901 as any), null);
});
test('password: over 72 bytes is refused (bcrypt silently ignores the rest)', () => {
  assert.notEqual(passwordProblem('x'.repeat(73)), null);
  assert.notEqual(passwordProblem('é'.repeat(40)), null); // 80 bytes in UTF-8
  assert.equal(passwordProblem('x'.repeat(72)), null);
});
test('password: common passwords are refused', () => {
  assert.notEqual(passwordProblem('password123'), null);
  assert.notEqual(passwordProblem('1234567890'), null);
  assert.notEqual(passwordProblem('PASSWORD123'), null);
});

// ---------- login throttling ----------
function clock(start = 1_000_000) { let t = start; return { now: () => t, add: (ms: number) => { t += ms; } }; }

test('login limiter: 5 failures allowed, 6th attempt blocked', () => {
  const c = clock();
  const lim = createLoginLimiter({ maxFailures: 5, windowMs: 15 * 60_000, now: c.now });
  for (let i = 0; i < 5; i++) { assert.equal(lim.check('k').allowed, true); lim.fail('k'); }
  const r = lim.check('k');
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterSec > 0 && r.retryAfterSec <= 15 * 60);
});
test('login limiter: unblocks after the window passes', () => {
  const c = clock();
  const lim = createLoginLimiter({ maxFailures: 2, windowMs: 60_000, now: c.now });
  lim.fail('k'); lim.fail('k');
  assert.equal(lim.check('k').allowed, false);
  c.add(60_001);
  assert.equal(lim.check('k').allowed, true);
});
test('login limiter: success clears the count', () => {
  const c = clock();
  const lim = createLoginLimiter({ maxFailures: 2, windowMs: 60_000, now: c.now });
  lim.fail('k'); lim.success('k'); lim.fail('k');
  assert.equal(lim.check('k').allowed, true);
});
test('login limiter: keys are independent', () => {
  const c = clock();
  const lim = createLoginLimiter({ maxFailures: 1, windowMs: 60_000, now: c.now });
  lim.fail('a');
  assert.equal(lim.check('a').allowed, false);
  assert.equal(lim.check('b').allowed, true);
});

// ---------- account ownership ----------
type Q = (sql: string, params: any[]) => Promise<{ rows: any[] }>;
const fakeDb: Q = async (_sql, [accountId, userId]) =>
  ({ rows: Number(accountId) === 48 && Number(userId) === 13 ? [{ id: 48 }] : [] });

test('ownership: owner owns the account', async () => {
  assert.equal(await makeOwnsAccount(fakeDb)(13, 48), true);
});
test('ownership: another user does not', async () => {
  assert.equal(await makeOwnsAccount(fakeDb)(9, 48), false);
});
test('ownership: garbage ids are refused without touching the database', async () => {
  let called = 0;
  const spy: Q = async (s, p) => { called++; return fakeDb(s, p); };
  const owns = makeOwnsAccount(spy);
  for (const bad of ['48abc', '', 'NaN', '-1', '0', '1.5', undefined, null]) {
    assert.equal(await owns(13, bad as any), false, String(bad));
  }
  assert.equal(await owns(undefined as any, 48), false);
  assert.equal(called, 0);
});

function fakeRes() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
test('requireAccount middleware: owner passes through', async () => {
  const mw = makeRequireAccount(makeOwnsAccount(fakeDb), req => req.params.account_id);
  let nexted = false;
  await mw({ userId: 13, params: { account_id: '48' } } as any, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true);
});
test('requireAccount middleware: other user gets 403 and never reaches the route', async () => {
  const mw = makeRequireAccount(makeOwnsAccount(fakeDb), req => req.params.account_id);
  let nexted = false; const res = fakeRes();
  await mw({ userId: 9, params: { account_id: '48' } } as any, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
});
test('requireAccount middleware: database error gives 500, not a pass', async () => {
  const broken: Q = async () => { throw new Error('db down'); };
  const mw = makeRequireAccount(makeOwnsAccount(broken), req => req.params.account_id);
  let nexted = false; const res = fakeRes();
  await mw({ userId: 13, params: { account_id: '48' } } as any, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /db down/); // no internal error text leaked
});
