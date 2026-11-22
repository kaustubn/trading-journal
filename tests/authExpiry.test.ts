/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-0123456789-abcdefghijklmnop';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyToken, userIdFromToken, generateToken } = require('../src/middleware/auth');

function call(token: string) {
  let status = 200, userId: number | undefined, nextCalled = false;
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  const res: any = { status(s: number) { status = s; return this; }, json() { return this; } };
  verifyToken(req, res, () => { nextCalled = true; userId = req.userId; });
  return { status, userId, nextCalled };
}

test('tokens the app issues (with an expiry) are accepted', () => {
  const r = call(generateToken(7));
  assert.equal(r.nextCalled, true); assert.equal(r.userId, 7);
  assert.equal(userIdFromToken(generateToken(9)), 9);
});

test('a correctly signed token WITHOUT an expiry is refused (old committed test tokens stop working)', () => {
  const noExp = jwt.sign({ userId: 7 }, process.env.JWT_SECRET!, { algorithm: 'HS256' });
  const r = call(noExp);
  assert.equal(r.nextCalled, false); assert.equal(r.status, 401);
  assert.equal(userIdFromToken(noExp), null);
});

test('expired and wrongly signed tokens are refused', () => {
  const expired = jwt.sign({ userId: 7, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET!, { algorithm: 'HS256' });
  assert.equal(call(expired).status, 401);
  const wrong = jwt.sign({ userId: 7 }, 'another-secret', { algorithm: 'HS256', expiresIn: '1h' });
  assert.equal(call(wrong).status, 401);
});
