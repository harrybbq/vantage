/**
 * The path player's arrangement.
 *
 * The four complaints this replaces were all about arrangement rather
 * than about styling, so this is where the change either works or does
 * not: does a step number mean something, does the player land on
 * something you can do, is a standalone goal shown as standalone rather
 * than dressed up as the root of a tree.
 */
import assert from 'node:assert/strict';
import {
  parentsOf, childrenOf, stateOf, isLocked, depths, queueFor,
  pathsOf, stepIndexFor, wouldCycle, thumbLayout, mapLayout,
} from './pathPlayer.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// The board from the mockup: a four-step money path, a three-step
// running path, a two-parent career path, and two goals on no path.
const A = [
  { id: 'cc', name: 'Clear the credit card', coins: 120, category: 'finance', completed: true },
  { id: 'spend', name: 'Cut monthly spend', coins: 80, category: 'finance', completed: true },
  { id: 'dep', name: 'Save a £5k deposit', coins: 400, category: 'finance' },
  { id: 'mip', name: 'Mortgage in principle', coins: 150, category: 'finance', locked: true },
  { id: 'home', name: 'Buy the first home', coins: 1000, category: 'finance', locked: true },
  { id: '5k', name: 'Run 5k without stopping', coins: 100, category: 'fitness', completed: true },
  { id: '10k', name: 'Run 10k', coins: 200, category: 'fitness' },
  { id: 'half', name: 'Half marathon', coins: 500, category: 'fitness', locked: true },
  { id: 'course', name: 'Finish the design course', coins: 150, category: 'brain' },
  { id: 'folio', name: 'Build a portfolio', coins: 250, category: 'brain' },
  { id: 'role', name: 'Switch into a design role', coins: 600, category: 'brain', locked: true },
  { id: 'guitar', name: 'Learn guitar', coins: 90, category: 'brain' },
  { id: 'books', name: 'Read 12 books', coins: 120, category: 'brain' },
];
const C = [
  ['cc', 'dep'], ['spend', 'dep'], ['dep', 'mip'], ['mip', 'home'],
  ['5k', '10k'], ['10k', 'half'],
  ['course', 'role'], ['folio', 'role'],
];
const byId = id => A.find(a => a.id === id);

// ── Edges ──
{
  eq(parentsOf(C, 'dep').sort(), ['cc', 'spend'], 'a goal knows what it waits on');
  eq(childrenOf(C, 'dep'), ['mip'], 'and what waits on it');
  eq(parentsOf(C, 'guitar'), [], 'a standalone goal waits on nothing');
  eq(parentsOf(null, 'dep'), [], 'and no connections is not a crash');
}

// ── State ──
{
  eq(stateOf(A, C, byId('cc')), 'completed', 'done is done');
  eq(stateOf(A, C, byId('dep')), 'active', 'both prerequisites met, so it is open');
  eq(stateOf(A, C, byId('mip')), 'locked', 'its prerequisite is not');
  eq(stateOf(A, C, byId('guitar')), 'active', 'nothing blocks a standalone goal');
  eq(stateOf(A, C, null), 'locked', 'and nothing at all is not a crash');

  // The stored flag is honoured even when the graph disagrees, because
  // it is what the complete handler consults.
  const stale = A.map(a => a.id === 'dep' ? { ...a, locked: true } : a);
  eq(stateOf(stale, C, stale.find(a => a.id === 'dep')), 'locked',
    'a stale locked flag is believed rather than offering a button that silently fails');
  ok(isLocked(stale, C, stale.find(a => a.id === 'dep')), 'same answer from isLocked');
}

// ── Depth ──
{
  const money = ['cc', 'spend', 'dep', 'mip', 'home'];
  const d = depths(money, C);
  eq(d.get('cc'), 0, 'a root is depth 0');
  eq(d.get('spend'), 0, 'and so is the other root');
  eq(d.get('dep'), 1, 'the goal both feed is one deeper');
  eq(d.get('mip'), 2, 'then two');
  eq(d.get('home'), 3, 'then three');

  // Depth is the LONGEST chain, not the shortest: a shortcut edge must
  // not pull a goal back up the path.
  const shortcut = depths(money, [...C, ['cc', 'home']]);
  eq(shortcut.get('home'), 3, 'a shortcut does not shorten the path');

  // A cycle in the data must not hang the relaxation.
  const looped = depths(['a', 'b'], [['a', 'b'], ['b', 'a']]);
  ok(Number.isFinite(looped.get('a')), 'a cycle terminates rather than spinning');
}

// ── The queue ──
{
  const q = queueFor(A, C, ['cc', 'spend', 'dep', 'mip', 'home']).map(g => g.id);
  eq(q, ['cc', 'spend', 'dep', 'mip', 'home'], 'the money path reads in dependency order');

  // Within one depth: what you can do, then what you have done, then
  // what is blocked. Never swipe onto a wall while something at the same
  // level is workable.
  const mixed = queueFor(
    [{ id: 'x', name: 'X', locked: true }, { id: 'y', name: 'Y', completed: true }, { id: 'z', name: 'Z' }],
    [], ['x', 'y', 'z'],
  ).map(g => g.id);
  eq(mixed, ['z', 'y', 'x'], 'open first, then done, then blocked');

  // Ties break on name so the sequence does not jitter between renders.
  const tied = queueFor(
    [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }], [], ['b', 'a'],
  ).map(g => g.id);
  eq(tied, ['a', 'b'], 'and equal goals come out in a stable order');
  eq(queueFor(A, C, ['nope']), [], 'an id with no goal behind it is dropped, not undefined');
}

// ── Paths ──
{
  const paths = pathsOf(A, C);
  eq(paths.length, 5, 'three linked paths and two standalone goals');

  const money = paths.find(p => p.ids.includes('dep'));
  eq(money.total, 5, 'the money path has five steps');
  eq(money.done, 2, 'two of them done');
  eq(money.title, 'Buy the first home', 'named by where it leads');
  eq(money.nextUp.id, 'dep', 'and the next thing to do is the deposit');
  ok(!money.standalone, 'it is not standalone');

  const career = paths.find(p => p.ids.includes('role'));
  eq(career.title, 'Switch into a design role', 'two roots, one end — named by the end');

  const solo = paths.find(p => p.ids.includes('guitar'));
  eq(solo.total, 1, 'a goal on no path is a path of one');
  ok(solo.standalone, 'and says so');
  eq(solo.title, 'Learn guitar', 'named after itself');

  // Biggest first, so the rail does not reshuffle as goals complete.
  eq(paths[0].total, 5, 'the biggest path leads');
  ok(paths[paths.length - 1].standalone, 'and the standalone ones bring up the rear');

  eq(pathsOf([], []), [], 'an empty board has no paths');
  eq(pathsOf(null, null), [], 'and neither does nothing at all');
}

// A path where every step is done reports as complete rather than as
// having a next step.
{
  const done = pathsOf(
    [{ id: 'a', name: 'A', completed: true }, { id: 'b', name: 'B', completed: true }],
    [['a', 'b']],
  )[0];
  eq(done.pct, 1, 'a finished path is at 100%');
  eq(done.nextUp, null, 'with nothing next');
}

// ── Where the player lands ──
{
  const money = pathsOf(A, C).find(p => p.ids.includes('dep'));
  eq(stepIndexFor(money, 0, false, A), 2,
    'untouched, it lands on the deposit — not on step 1 of a chain finished months ago');
  eq(stepIndexFor(money, 4, true, A), 4, 'once moved, it stays where it was put');
  eq(stepIndexFor(money, 99, true, A), 4, 'clamped to the end');
  eq(stepIndexFor(money, -3, true, A), 0, 'and to the start');
  eq(stepIndexFor(null, 0, false, A), 0, 'no path, no step');

  // A path with nothing workable still has to show something.
  const blocked = pathsOf(
    [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', locked: true }], [['a', 'b']],
  )[0];
  const allDone = pathsOf(
    [{ id: 'a', name: 'A', completed: true }], [],
  )[0];
  eq(stepIndexFor(blocked, 0, false, blocked.queue), 0, 'it falls back to the first step');
  eq(stepIndexFor(allDone, 0, false, allDone.queue), 0, 'and a finished path opens at its first step');
}

// ── Cycles ──
{
  ok(wouldCycle(C, 'home', 'cc'), 'linking the end back to the start would loop');
  ok(wouldCycle(C, 'dep', 'dep'), 'and so would linking a goal to itself');
  ok(!wouldCycle(C, 'guitar', 'books'), 'two unrelated goals do not');
  ok(!wouldCycle(C, 'home', 'guitar'), 'nor does extending a path onto a loose goal');
  ok(!wouldCycle(C, null, 'cc'), 'a missing end is not a cycle');
  ok(wouldCycle([['a', 'b'], ['b', 'c']], 'c', 'a'), 'a longer way round is still a way round');
}

// ── The thumbnail ──
{
  const money = pathsOf(A, C).find(p => p.ids.includes('dep'));
  const t = thumbLayout(money, { currentId: 'dep' });
  eq(t.nodes.length, 5, 'every goal is on the map');
  eq(t.edges.length, 4, 'and every link');
  eq(t.viewBox, '0 0 120 34', 'in the space a thumbnail has');
  ok(t.nodes.every(nd => nd.x >= 0 && nd.x <= 120 && nd.y >= 0 && nd.y <= 34), 'nothing falls off it');
  eq(t.nodes.filter(nd => nd.here).length, 1, 'exactly one node is lit as where you are');
  eq(t.nodes.find(nd => nd.id === 'dep').here, true, 'and it is the step being played');

  const roots = t.nodes.filter(nd => nd.id === 'cc' || nd.id === 'spend');
  eq(roots[0].x, roots[1].x, 'goals at the same depth share a column');
  ok(roots[0].y !== roots[1].y, 'and are spread down it');
  ok(t.edges.find(e => e.key === 'cc-dep').done, 'a link out of a finished goal reads as done');
  ok(!t.edges.find(e => e.key === 'dep-mip').done, 'and one out of an unfinished goal does not');

  eq(thumbLayout(null).nodes, [], 'no path, no thumbnail');
  const single = thumbLayout(pathsOf(A, C).find(p => p.ids.includes('guitar')));
  eq(single.nodes.length, 1, 'a standalone goal is one dot');
  eq(single.nodes[0].y, 17, 'centred rather than pinned to the top');
}

// ── The expanded map ──
{
  const money = pathsOf(A, C).find(p => p.ids.includes('dep'));
  const m = mapLayout(money);
  eq(m.nodes.length, 5, 'every goal is tappable');
  eq(m.edges.length, 4, 'with its links drawn');
  ok(m.nodes.every(nd => nd.left >= 0 && nd.left + nd.w <= 336 + 0.001),
    'and nothing overflows the width it was given');
  const roots = m.nodes.filter(nd => nd.id === 'cc' || nd.id === 'spend');
  eq(roots[0].top, roots[1].top, 'a row is a depth');
  ok(roots[0].left !== roots[1].left, 'and its goals sit side by side');
  ok(m.h > 4 * 46, 'four depths need more than one card of height');

  // Three at one depth wrap rather than shrinking to an unreadable width.
  const wide = mapLayout(pathsOf(
    [{ id: 'r', name: 'Root' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    [['r', 'a'], ['r', 'b'], ['r', 'c']],
  )[0]);
  const kids = wide.nodes.filter(nd => nd.id !== 'r');
  eq(new Set(kids.map(nd => nd.top)).size, 2, 'three at a depth become two rows, not three columns');
  ok(kids.every(nd => nd.w >= 140), 'so a name still has room');

  eq(mapLayout(null).nodes, [], 'no path, no map');
}

// Nothing may sit on top of anything else. A depth that WRAPS is the case
// that breaks a fixed stride per depth: three goals at depth 0 take two
// rows of cards, and the next depth was being placed as if it had taken
// one — the career path overlapped its own end goal by 38px.
{
  const overlapping = (a, b) =>
    a.left < b.left + b.w && b.left < a.left + a.w &&
    a.top < b.top + 46 && b.top < a.top + 46;

  const shapes = [
    // course + portfolio + references → role
    [[{ id: 'c1', name: 'Course' }, { id: 'c2', name: 'Portfolio' }, { id: 'c3', name: 'References' },
      { id: 'r', name: 'Role' }],
     [['c1', 'r'], ['c2', 'r'], ['c3', 'r']]],
    // five at one depth feeding two at the next
    [[{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'x' }, { id: 'y' }]
      .map((g, i) => ({ ...g, name: 'G' + i })),
     [['a', 'x'], ['b', 'x'], ['c', 'y'], ['d', 'y'], ['e', 'y']]],
    // a straight chain, which must not regress
    [[{ id: 'p' }, { id: 'q' }, { id: 's' }].map((g, i) => ({ ...g, name: 'N' + i })),
     [['p', 'q'], ['q', 's']]],
  ];

  for (const [achs, conns] of shapes) {
    const m = mapLayout(pathsOf(achs, conns)[0]);
    let clashes = 0;
    for (let i = 0; i < m.nodes.length; i++) {
      for (let j = i + 1; j < m.nodes.length; j++) {
        if (overlapping(m.nodes[i], m.nodes[j])) clashes++;
      }
    }
    eq(clashes, 0, `no two cards overlap (${m.nodes.length} goals)`);
    ok(m.h >= Math.max(...m.nodes.map(nd => nd.top)) + 46, 'and the canvas is tall enough to hold them');
  }
}

console.log(`path player: ${n} assertions passed`);
