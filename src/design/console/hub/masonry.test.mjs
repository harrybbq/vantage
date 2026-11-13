// node src/design/console/hub/masonry.test.mjs — the hub's content-height layout.
import assert from 'node:assert/strict';
import { packMasonry, dropIndexMasonry } from './masonry.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const it = (id, size, h) => ({ id, size, h });
const pack = (items, gap = 16) => packMasonry(items, 4, x => x.size, x => x.h, gap);
const by = r => Object.fromEntries(r.cells.map(c => [c.id, c]));

t('a card is as tall as its content, not as its neighbour', () => {
  const r = by(pack([it('today', 'large', 449), it('league', 'medium', 120)]));
  assert.deepEqual([r.today.col, r.today.y, r.today.h], [0, 0, 449]);
  assert.deepEqual([r.league.col, r.league.y, r.league.h], [2, 0, 120], 'the short card keeps its own height');
});

t('the next card goes under the shorter side', () => {
  const r = by(pack([it('a', 'large', 400), it('b', 'medium', 100), it('c', 'medium', 150), it('d', 'medium', 90)]));
  assert.deepEqual([r.c.col, r.c.y], [2, 116], 'under b, not under the tall a');
  assert.deepEqual([r.d.col, r.d.y], [2, 282]);
});

t('wide cards sit on a half, never across the middle', () => {
  const r = pack([it('s', 'small', 100), it('w', 'medium', 100), it('x', 'large', 100)]);
  for (const c of r.cells) if (c.w === 2) assert.ok(c.col === 0 || c.col === 2, c.id);
});

t('small cards fill the shortest column, left first', () => {
  const r = by(pack([it('a', 'small', 200), it('b', 'small', 100), it('c', 'small', 50), it('d', 'small', 80), it('e', 'small', 10)]));
  assert.deepEqual([r.a.col, r.b.col, r.c.col, r.d.col], [0, 1, 2, 3]);
  assert.deepEqual([r.e.col, r.e.y], [2, 66], 'under the shortest');
});

t('a hole under the shorter of two smalls is closed by stretching it', () => {
  const r = by(pack([it('a', 'small', 277), it('b', 'small', 120), it('w', 'medium', 400), it('z', 'large', 300)]));
  // w goes right (y 0) and is tall, so z goes left at y = 277 + 16; b stretches to meet it.
  assert.deepEqual([r.z.col, r.z.y], [0, 293]);
  assert.deepEqual([r.b.h, r.b.extra, r.b.w], [277, 157, 1]);
  assert.equal(r.a.extra, 0);
});

t('no overlaps, nothing outside, total height is the lowest bottom', () => {
  const sizes = ['small', 'medium', 'large'];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 300; round++) {
    const items = Array.from({ length: 1 + Math.floor(rnd() * 16) }, (_, i) => it('i' + i, sizes[Math.floor(rnd() * 3)], 60 + Math.floor(rnd() * 500)));
    const r = pack(items);
    assert.equal(r.cells.length, items.length);
    for (const a of r.cells) {
      assert.ok(a.col >= 0 && a.col + a.w <= 4 && a.y >= 0);
      assert.ok(a.h >= items.find(x => x.id === a.id).h - 1e-6, 'never shorter than its content');
      for (const b of r.cells) {
        if (a === b) continue;
        const xo = a.col < b.col + b.w && b.col < a.col + a.w;
        const yo = a.y < b.y + b.h + 16 - 1e-6 && b.y < a.y + a.h + 16 - 1e-6;
        assert.ok(!(xo && yo), `overlap or touching ${a.id}/${b.id} in round ${round}`);
      }
    }
    assert.equal(r.height, Math.max(...r.cells.map(c => c.y + c.h)));
    // No hole directly above a wide card: both its columns are covered to within the gap.
    for (const wd of r.cells.filter(c => c.w === 2 && c.y > 0)) {
      for (let k = wd.col; k < wd.col + 2; k++) {
        const above = r.cells.filter(c => c !== wd && c.col <= k && k < c.col + c.w && c.y < wd.y);
        if (!above.length) continue;
        const bottom = Math.max(...above.map(c => c.y + c.h));
        assert.ok(Math.abs(wd.y - bottom - 16) < 1e-6, `hole above ${wd.id} col ${k} in round ${round}`);
      }
    }
  }
});

t('a lone small with an empty half beside it takes both columns', () => {
  const r = by(pack([it('w1', 'medium', 100), it('big', 'large', 600), it('s', 'small', 150), it('w2', 'medium', 120)]));
  // s goes under w1 (left, y 116); w2 follows on the same half, so s widens.
  assert.deepEqual([r.s.col, r.s.w, r.s.y, r.s.widened], [0, 2, 116, true]);
  assert.deepEqual([r.w2.col, r.w2.y], [0, 282]);
  // …and at the foot of a half, with nothing coming after it.
  const r3 = by(pack([it('w1', 'medium', 100), it('big', 'large', 600), it('s', 'small', 150)]));
  assert.deepEqual([r3.s.col, r3.s.w, r3.s.widened], [0, 2, true]);
  // With a second small to sit beside it, it stays small.
  const r2 = by(pack([it('w1', 'medium', 100), it('big', 'large', 600), it('s', 'small', 150), it('s2', 'small', 150), it('w2', 'medium', 120)]));
  assert.deepEqual([r2.s.w, r2.s2.w, r2.s2.col], [1, 1, 1]);
});

t('empty hub; unknown heights place as zero', () => {
  assert.deepEqual(pack([]), { cells: [], height: 0 });
  const r = packMasonry([{ id: 'a', size: 'small' }], 4, x => x.size, () => undefined, 16);
  assert.deepEqual([r.cells[0].h, r.height], [0, 0]);
});

t('drop: the dragged card goes where it lands nearest the pointer; staying put wins ties', () => {
  const items = [it('a', 'medium', 200), it('b', 'medium', 200), it('c', 'medium', 200), it('d', 'medium', 200)];
  const geom = { colW: 200, gap: 16 };
  const drop = (from, x, y) => dropIndexMasonry(items, from, { x, y }, 4, i => i.size, i => i.h, geom);
  // a sits top-left (centre 208,100). Dropped on itself → no move.
  assert.equal(drop(0, 208, 100), 0);
  // dragged to the right half, top → swaps with b.
  assert.equal(drop(0, 640, 100), 1);
  // dragged to bottom-right (where d is) → last.
  assert.equal(drop(0, 640, 316), 3);
  assert.equal(dropIndexMasonry(items, 9, { x: 0, y: 0 }, 4, i => i.size, i => i.h, geom), 9, 'bad index is returned as is');
});

t('six columns (a very wide screen): three large cards to a row, and the same rules hold', () => {
  const pack6 = items => packMasonry(items, 6, x => x.size, x => x.h, 16);
  const r = by(pack6([it('a', 'large', 300), it('b', 'large', 200), it('c', 'large', 250), it('d', 'medium', 100), it('e', 'small', 80), it('f', 'small', 120)]));
  assert.deepEqual([r.a.col, r.b.col, r.c.col], [0, 2, 4], 'left to right across the three halves');
  assert.deepEqual([r.a.y, r.b.y, r.c.y], [0, 0, 0]);
  assert.deepEqual([r.d.col, r.d.y], [2, 216], 'the next card goes under the shortest');
  // The two smalls share the next-shortest pair of columns and end level.
  assert.equal(r.e.w, 1); assert.equal(r.f.w, 1);
  assert.equal(r.e.y + r.e.h, r.f.y + r.f.h);
  // No overlaps, nothing outside the six columns, at random sizes and heights.
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 60; k++) {
    const items = Array.from({ length: 3 + Math.floor(rnd() * 12) }, (_, i) => it('x' + i, ['small', 'medium', 'large'][Math.floor(rnd() * 3)], 60 + Math.floor(rnd() * 400)));
    const out = pack6(items);
    for (const c of out.cells) assert.ok(c.col >= 0 && c.col + c.w <= 6 && (c.w === 1 || c.col % 2 === 0), `cell in bounds, wide cards on a pair: ${JSON.stringify(c)}`);
    for (let i = 0; i < out.cells.length; i++) for (let j = i + 1; j < out.cells.length; j++) {
      const a = out.cells[i], b = out.cells[j];
      const side = a.col < b.col + b.w && b.col < a.col + a.w, up = a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
      assert.ok(!(side && up), `overlap ${a.id}/${b.id}`);
    }
    assert.ok(out.height >= Math.max(...out.cells.map(c => c.y + c.h)) - 0.01);
  }
});

console.log(`hub masonry: ${n} tests passed`);
