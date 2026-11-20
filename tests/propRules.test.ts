/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawdownFloor, bufferLevel, PROP_PRESETS } from '../src/shared/propRules';

// day 1: +800 then -500 (EOD +300); day 2: +1200 (EOD +1500); day 3: -900
const T = [{ day: 'd1', pnl: 800 }, { day: 'd1', pnl: -500 }, { day: 'd2', pnl: 1200 }, { day: 'd3', pnl: -900 }];

test('static floor never moves', () => {
  const f = drawdownFloor(T, 50000, 2000, 'static', false);
  assert.equal(f.floor, 48000);
  assert.equal(f.equity, 50600);
  assert.equal(f.buffer, 2600);
});

test('EOD trails end-of-day highs only; intraday trails every closed-trade high', () => {
  const eod = drawdownFloor(T, 50000, 2000, 'eod', false);
  assert.equal(eod.peak, 51500);       // end of day 2
  assert.equal(eod.floor, 49500);
  const intra = drawdownFloor(T, 50000, 2000, 'intraday', false);
  assert.equal(intra.peak, 51500);     // day-2 trade high (same here)
  const spike = [{ day: 'd1', pnl: 1500 }, { day: 'd1', pnl: -1400 }];
  assert.equal(drawdownFloor(spike, 50000, 2000, 'eod', false).floor, 48100);      // EOD peak 50,100
  assert.equal(drawdownFloor(spike, 50000, 2000, 'intraday', false).floor, 49500); // intraday peak 51,500
});

test('lock at start: the trailing floor stops at the starting balance', () => {
  const up = [{ day: 'd1', pnl: 3000 }];
  const f = drawdownFloor(up, 50000, 2000, 'eod', true);
  assert.equal(f.floor, 50000);
  assert.equal(f.locked, true);
  assert.equal(drawdownFloor(up, 50000, 2000, 'eod', false).floor, 51000);
});

test('buffer levels and presets are sane', () => {
  assert.equal(bufferLevel(1500, 2000), 'ok');
  assert.equal(bufferLevel(800, 2000), 'watch');
  assert.equal(bufferLevel(300, 2000), 'danger');
  assert.equal(bufferLevel(0, 2000), 'breached');
  for (const p of PROP_PRESETS) {
    assert.ok(p.size > 0 && p.checked && p.source, p.id);
    if (p.maxDrawdown != null) assert.ok(p.maxDrawdown < p.size, p.id);
  }
  assert.equal(new Set(PROP_PRESETS.map(p => p.id)).size, PROP_PRESETS.length);
});
