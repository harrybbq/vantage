/**
 * The report queue reader. The thing that matters most: a missing
 * function (501, 404, or the SPA shell) reads as "not installed", never
 * as an error or an empty-and-healthy queue.
 */
import assert from 'node:assert/strict';
import { readQueueResponse, normaliseReport, openCounts, sortQueue } from './queue.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ── Response states ──
{
  eq(readQueueResponse(501, '{"error":"not installed"}').state, 'not-installed', '501');
  eq(readQueueResponse(404, '').state, 'not-installed', '404');
  eq(readQueueResponse(200, '<!doctype html><html></html>').state, 'not-installed', 'SPA shell under vite');
  eq(readQueueResponse(403, '{"error":"owner only"}').state, 'forbidden', '403');
  const e = readQueueResponse(500, '{"error":"boom"}');
  eq([e.state, e.error], ['error', 'boom'], '500 carries the message');
  eq(readQueueResponse(502, 'garbage').error, "The queue didn't load (HTTP 502).", 'unparseable error body');
  eq(readQueueResponse(200, '{"reports":[]}'), { state: 'ok', reports: [] }, 'empty queue is ok');
  eq(readQueueResponse(200, '[{"id":1}]').reports.length, 1, 'bare array accepted');
  eq(readQueueResponse(200, '{"queue":[{"id":1},{"nope":true}]}').reports.length, 1, 'rows without id dropped');
}

// ── Row shape ──
{
  const live = normaliseReport({
    id: 'r1', created_at: '2026-09-30T10:00:00Z', reason: 'Spam', reported_id: 'u1',
    reported: { display_name: 'Now', handle: 'now', suspended_at: '2026-09-30T11:00:00Z' },
    reported_snapshot: { display_name: 'Then', handle: 'then', where: 'leaderboard' },
  });
  eq([live.name, live.handle, live.suspended, live.where, live.deleted], ['Now', 'now', true, 'leaderboard', false], 'live profile wins');

  const gone = normaliseReport({ id: 'r2', reported_id: null, reported_snapshot: { display_name: 'Then', handle: 'then' } });
  eq([gone.name, gone.handle, gone.deleted, gone.status], ['Then', 'then', true, 'open'], 'deleted account falls back to snapshot');

  eq(normaliseReport({ id: 'r3', reported_id: 'u2' }).name, null, 'no names at all');
  eq(normaliseReport(null), null, 'null row');

  // What netlify/functions/moderation.js actually answers.
  const page = readQueueResponse(200, JSON.stringify({
    ok: true, page: 0, pageSize: 25, total: 40,
    items: [{
      id: 'r9', createdAt: '2026-10-01T09:00:00Z', reason: 'Harassment', context: 'DMs',
      snapshot: { display_name: 'Then', handle: 'then', where: 'messages' },
      reporter: { id: 'u1', handle: 'alice' },
      reported: { id: 'u2', handle: 'bob', name: 'Bob', suspendedAt: null },
      messages: [{ from: 'reported', body: 'hey', at: '2026-10-01T08:59:00Z' }, null],
    }, {
      id: 'r10', createdAt: '2026-10-01T10:00:00Z', reported: null,
      snapshot: { display_name: 'Gone', handle: 'gone' },
    }],
  }));
  eq([page.state, page.total, page.reports.length], ['ok', 40, 2], 'items + total read');
  const fn = page.reports[0];
  eq([fn.at, fn.reportedId, fn.name, fn.handle, fn.where, fn.reporter, fn.suspended, fn.messages.length],
    ['2026-10-01T09:00:00Z', 'u2', 'Bob', 'bob', 'messages', 'alice', false, 1], 'function shape normalised');
  eq([page.reports[1].deleted, page.reports[1].name], [true, 'Gone'], 'deleted account in function shape');
  eq(normaliseReport({ id: 'r11', reported: { id: 'u3', suspendedAt: '2026-10-01' } }).suspended, true, 'camelCase suspension');
}

// ── Counting and order ──
{
  const rows = [
    { id: 1, reportedId: 'a', status: 'open', at: '2026-09-28' },
    { id: 2, reportedId: 'a', status: 'open', at: '2026-09-30' },
    { id: 3, reportedId: 'a', status: 'dismissed', at: '2026-09-29' },
    { id: 4, reportedId: null, status: 'open', at: '2026-09-27' },
  ];
  const c = openCounts(rows);
  eq(c.get('a'), 2, 'dismissed reports do not count');
  ok(!c.has(null), 'deleted accounts are not grouped under null');
  eq(sortQueue(rows).map(r => r.id), [2, 1, 4, 3], 'open newest first, then the rest');
}

console.log(`moderation queue: ${n} checks passed`);
