/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptBeat, lockState, isStale, spreadBackwards, rescaleMinutes, SessionState, LOCK_SEC } from '../src/services/btSessionClock';

const T0 = new Date('2026-11-19T15:00:00Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const base = (over: Partial<SessionState> = {}): SessionState => ({
  status: 'running', last_seq: 0, last_beat_at: T0, lock_tab: 'tab-aaaaaaaa', lock_until: at(LOCK_SEC), ...over,
});

test('normal beat: adds its deltas, minutes add up to the active seconds', () => {
  const r = acceptBeat(base(), { tabId: 'tab-aaaaaaaa', seq: 1, activeSec: 25, idleSec: 0, pauseSec: 5 }, at(30));
  assert.equal(r.ok, true);
  assert.deepEqual(r.add, { active: 25, idle: 0, pause: 5 });
  assert.equal(r.minutes.reduce((a, m) => a + m.sec, 0), 25);
});

test('retried or old seq adds nothing (no double counting)', () => {
  const s = base({ last_seq: 4 });
  assert.equal(acceptBeat(s, { tabId: 'tab-aaaaaaaa', seq: 4, activeSec: 30, idleSec: 0, pauseSec: 0 }, at(30)).reason, 'duplicate');
  assert.equal(acceptBeat(s, { tabId: 'tab-aaaaaaaa', seq: 2, activeSec: 30, idleSec: 0, pauseSec: 0 }, at(30)).reason, 'duplicate');
});

test('a second tab cannot write while the first holds the lock; it can after the lock expires', () => {
  const s = base();
  const other = { tabId: 'tab-bbbbbbbb', seq: 1, activeSec: 30, idleSec: 0, pauseSec: 0 };
  assert.equal(acceptBeat(s, other, at(30)).reason, 'locked');
  assert.equal(lockState(s, 'tab-bbbbbbbb', at(LOCK_SEC + 1)), 'free');
  assert.equal(acceptBeat(s, other, at(LOCK_SEC + 1)).ok, true);
});

test('a beat can never claim more time than really passed (45 s floor, +5 s slack), scaled proportionally', () => {
  const r = acceptBeat(base(), { tabId: 'tab-aaaaaaaa', seq: 1, activeSec: 600, idleSec: 0, pauseSec: 0 }, at(30));
  assert.equal(r.add.active, 45);
  const r2 = acceptBeat(base(), { tabId: 'tab-aaaaaaaa', seq: 1, activeSec: 200, idleSec: 100, pauseSec: 0 }, at(10));
  assert.equal(r2.add.active + r2.add.idle, 45); // 45 s cap split 2:1
  assert.equal(r2.add.active, 30);
});

test('offline catch-up: a tab back after 3 minutes may hand in up to 3 minutes', () => {
  const r = acceptBeat(base(), { tabId: 'tab-aaaaaaaa', seq: 1, activeSec: 170, idleSec: 10, pauseSec: 0 }, at(180));
  assert.deepEqual(r.add, { active: 170, idle: 10, pause: 0 });
});

test('negative, NaN and fractional deltas are cleaned', () => {
  const r = acceptBeat(base(), { tabId: 'tab-aaaaaaaa', seq: 1, activeSec: -5, idleSec: NaN as unknown as number, pauseSec: 7.9 }, at(30));
  assert.deepEqual(r.add, { active: 0, idle: 0, pause: 7 });
});

test('stopped sessions refuse beats; stale sessions are detected after 30 min', () => {
  assert.equal(acceptBeat(base({ status: 'stopped' }), { tabId: 'tab-aaaaaaaa', seq: 1, activeSec: 1, idleSec: 0, pauseSec: 0 }, at(5)).reason, 'stopped');
  assert.equal(isStale(base(), at(29 * 60)), false);
  assert.equal(isStale(base(), at(31 * 60)), true);
});

test('minutes: active time crossing a minute (and midnight UTC) is split exactly', () => {
  const now = new Date('2026-11-20T00:00:20Z');
  const m = spreadBackwards(50, now);
  assert.deepEqual(m, [
    { minute: Date.parse('2026-11-20T00:00:00Z'), sec: 20 },
    { minute: Date.parse('2026-11-19T23:59:00Z'), sec: 30 },
  ]);
});

test('manual edit rescales buckets to the new total', () => {
  const mins = [{ minute: 0, sec: 60 }, { minute: 60000, sec: 60 }, { minute: 120000, sec: 30 }];
  const out = rescaleMinutes(mins, 300);
  assert.equal(out.reduce((a, m) => a + m.sec, 0), 300);
  assert.deepEqual(rescaleMinutes(mins, 0), []);
});
