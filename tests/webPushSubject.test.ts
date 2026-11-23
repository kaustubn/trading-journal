/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vapidSubject } from '../src/services/webPush';

test('VAPID subject: a real https site address (Apple rejects .invalid / localhost with BadJwtToken)', () => {
  assert.equal(vapidSubject({ RENDER_EXTERNAL_URL: 'https://trading-journal-1qlf.onrender.com/' }), 'https://trading-journal-1qlf.onrender.com');
  assert.equal(vapidSubject({ PUBLIC_URL: 'https://journal.example.com', RENDER_EXTERNAL_URL: 'https://x.onrender.com' }), 'https://journal.example.com');
  assert.equal(vapidSubject({ PUBLIC_URL: 'http://localhost:5092' }), 'https://trading-journal-1qlf.onrender.com');
  assert.equal(vapidSubject({ PUBLIC_URL: 'https://alerts.trading-journal.invalid' }), 'https://trading-journal-1qlf.onrender.com');
  assert.equal(vapidSubject({}), 'https://trading-journal-1qlf.onrender.com');
});
