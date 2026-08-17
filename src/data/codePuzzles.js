/**
 * Runnable code puzzles.
 *
 * ── Why these are not the LeetCode problems ──────────────────────────
 * LeetCode's problem statements are their copyrighted text. The
 * curriculum in lib/career/problems.js links out to them for exactly
 * that reason and bundles only metadata. These are OURS: same patterns,
 * written from scratch, so they can carry a statement, a signature and
 * real test cases without lifting anything.
 *
 * That turns out to be the better design anyway. A LeetCode link is
 * homework you might do; a puzzle with a Run button and eight failing
 * cases is a thing you are already doing. Where a puzzle drills the same
 * pattern as a Blind-75 problem, `lc` points at it — do it here for the
 * reps, do it there for the real interview shape.
 *
 * ── How the tests are built ──────────────────────────────────────────
 * Each puzzle has a handful of visible cases and one or two HIDDEN ones.
 * Visible cases teach; hidden cases stop a solution that special-cases
 * the examples from passing. Every hidden case is chosen to break a
 * specific shortcut — the comment on each says which.
 *
 * Every answer is DETERMINISTIC and unique. "Return the two indices"
 * without a stated order is a puzzle whose test can only be wrong, so
 * where an answer could vary the statement pins it down.
 *
 * Pure data. No DOM, no React, no network.
 */

const P = (o) => ({ kind: 'code', id: 'code:' + o.slug, ...o });

export const CODE_PUZZLES = [
  P({
    slug: 'pair-sum',
    title: 'Pair that sums to the target',
    difficulty: 'Easy',
    topic: 'Arrays',
    pattern: 'Hash map',
    lc: 'two-sum',
    fnName: 'pairSum',
    signature: 'pairSum(nums, target) → [i, j]',
    prompt:
      'Given an array of integers and a target, return the indices of the two '
      + 'entries that add up to it, as [smaller index, larger index]. Exactly one '
      + 'pair works. Return [] if none does.\n\n'
      + 'The nested-loop answer is four lines and O(n²). The one worth writing is '
      + 'O(n): as you walk the array you already know every number behind you, so '
      + 'ask whether the one you need has already gone past.',
    starter:
      'function pairSum(nums, target) {\n'
      + '  // Walk once. What do you need to remember about what you have seen?\n'
      + '  \n'
      + '}\n',
    tests: [
      { args: [[2, 7, 11, 15], 9], expect: [0, 1] },
      { args: [[3, 2, 4], 6], expect: [1, 2] },
      { args: [[1, 2, 3], 100], expect: [] },
      // The answer uses the same VALUE twice. People guard against
      // reusing one element by skipping when the two values match —
      // which is the wrong guard, and returns [] here.
      { args: [[3, 3], 6], expect: [0, 1], hidden: true },
      // Negatives, and the pair at the very ends.
      { args: [[-8, 5, 1, -3, 4], -11], expect: [0, 3], hidden: true },
    ],
    hint: 'A map from value → index, filled as you go. For each number, look up target − number BEFORE inserting the current one.',
    solution:
      'function pairSum(nums, target) {\n'
      + '  const seen = new Map();\n'
      + '  for (let i = 0; i < nums.length; i++) {\n'
      + '    const need = target - nums[i];\n'
      + '    if (seen.has(need)) return [seen.get(need), i];\n'
      + '    seen.set(nums[i], i);\n'
      + '  }\n'
      + '  return [];\n'
      + '}',
  }),

  P({
    slug: 'has-duplicate',
    title: 'Any repeats?',
    difficulty: 'Easy',
    topic: 'Arrays',
    pattern: 'Hash set',
    lc: 'contains-duplicate',
    fnName: 'hasDuplicate',
    signature: 'hasDuplicate(nums) → boolean',
    prompt:
      'Return true if any value appears more than once.\n\n'
      + 'Two lines if you reach for the right structure. The point of the puzzle is '
      + 'noticing that "have I seen this before" is a set question, not a loop.',
    starter: 'function hasDuplicate(nums) {\n  \n}\n',
    tests: [
      { args: [[1, 2, 3, 4]], expect: false },
      { args: [[1, 2, 3, 1]], expect: true },
      { args: [[]], expect: false },
      // Mixed types: a Set separates 1 from "1"; a sort-and-compare
      // built on string coercion does not.
      { args: [[1, '1', 2]], expect: false, hidden: true },
      { args: [[0, -0]], expect: true, hidden: true },
    ],
    hint: 'new Set(nums).size tells you how many distinct values there were.',
    solution: 'function hasDuplicate(nums) {\n  return new Set(nums).size !== nums.length;\n}',
  }),

  P({
    slug: 'best-profit',
    title: 'Best single trade',
    difficulty: 'Easy',
    topic: 'Arrays',
    pattern: 'Running minimum',
    lc: 'best-time-to-buy-and-sell-stock',
    fnName: 'bestProfit',
    signature: 'bestProfit(prices) → number',
    prompt:
      'prices[i] is the price on day i. Buy once and sell once, later. Return the '
      + 'largest profit available, or 0 if every trade loses money.\n\n'
      + 'One pass. The best sale today is today\'s price minus the cheapest day so '
      + 'far — so you only ever need one number in hand.',
    starter: 'function bestProfit(prices) {\n  \n}\n',
    tests: [
      { args: [[7, 1, 5, 3, 6, 4]], expect: 5 },
      { args: [[7, 6, 4, 3, 1]], expect: 0 },
      { args: [[2, 4, 1]], expect: 2 },
      { args: [[]], expect: 0, hidden: true },
      // The minimum arrives AFTER the best sale. Tracking global min and
      // global max independently returns 8 here, and it is wrong.
      { args: [[3, 11, 2, 4]], expect: 8, hidden: true },
    ],
    hint: 'Keep the cheapest price seen so far. At each day, profit = price − cheapest; keep the best.',
    solution:
      'function bestProfit(prices) {\n'
      + '  let low = Infinity, best = 0;\n'
      + '  for (const p of prices) {\n'
      + '    if (p < low) low = p;\n'
      + '    else if (p - low > best) best = p - low;\n'
      + '  }\n'
      + '  return best;\n'
      + '}',
  }),

  P({
    slug: 'max-run',
    title: 'Best contiguous run',
    difficulty: 'Medium',
    topic: 'Arrays',
    pattern: 'Kadane',
    lc: 'maximum-subarray',
    fnName: 'maxRun',
    signature: 'maxRun(nums) → number',
    prompt:
      'Return the largest sum obtainable from a contiguous, non-empty slice of the '
      + 'array.\n\n'
      + 'The trick is one question asked at every element: is the run so far helping '
      + 'me, or would I be better off starting again from here?',
    starter: 'function maxRun(nums) {\n  \n}\n',
    tests: [
      { args: [[-2, 1, -3, 4, -1, 2, 1, -5, 4]], expect: 6 },
      { args: [[1]], expect: 1 },
      { args: [[5, 4, -1, 7, 8]], expect: 23 },
      // All negative. Anything that starts `best = 0` returns 0, and 0
      // is not a sum of a non-empty slice.
      { args: [[-3, -1, -7]], expect: -1, hidden: true },
      { args: [[-1, -2, 5, -1, -2, 6]], expect: 8, hidden: true },
    ],
    hint: 'running = max(x, running + x); best = max(best, running). Seed both from the first element, not from 0.',
    solution:
      'function maxRun(nums) {\n'
      + '  let best = nums[0], run = nums[0];\n'
      + '  for (let i = 1; i < nums.length; i++) {\n'
      + '    run = Math.max(nums[i], run + nums[i]);\n'
      + '    best = Math.max(best, run);\n'
      + '  }\n'
      + '  return best;\n'
      + '}',
  }),

  P({
    slug: 'product-except-self',
    title: 'Product of everything else',
    difficulty: 'Medium',
    topic: 'Arrays',
    pattern: 'Prefix / suffix',
    lc: 'product-of-array-except-self',
    fnName: 'productExceptSelf',
    signature: 'productExceptSelf(nums) → number[]',
    prompt:
      'Return an array where out[i] is the product of every element EXCEPT nums[i]. '
      + 'No division — and it has to survive a zero in the input, which is the real '
      + 'reason division is off the table.\n\n'
      + 'Two passes: everything to the left, then everything to the right.',
    starter: 'function productExceptSelf(nums) {\n  \n}\n',
    tests: [
      { args: [[1, 2, 3, 4]], expect: [24, 12, 8, 6] },
      { args: [[2, 3]], expect: [3, 2] },
      // One zero: every other slot is 0, the zero's slot is the product
      // of the rest. Divide-the-total dies here.
      { args: [[1, 0, 3]], expect: [0, 3, 0], hidden: true },
      // Two zeros: everything is 0.
      { args: [[0, 4, 0]], expect: [0, 0, 0], hidden: true },
      { args: [[-1, 1, 0, -3, 3]], expect: [0, 0, 9, 0, 0], hidden: true },
    ],
    hint: 'Fill out[i] with the product of everything before i on the way up, then multiply by the product of everything after i on the way down.',
    solution:
      'function productExceptSelf(nums) {\n'
      + '  const out = new Array(nums.length).fill(1);\n'
      + '  let acc = 1;\n'
      + '  for (let i = 0; i < nums.length; i++) { out[i] = acc; acc *= nums[i]; }\n'
      + '  acc = 1;\n'
      + '  for (let i = nums.length - 1; i >= 0; i--) { out[i] *= acc; acc *= nums[i]; }\n'
      + '  return out;\n'
      + '}',
  }),

  P({
    slug: 'is-palindrome',
    title: 'Palindrome, letters and digits only',
    difficulty: 'Easy',
    topic: 'Strings',
    pattern: 'Two pointers',
    lc: 'valid-palindrome',
    fnName: 'isPalindrome',
    signature: 'isPalindrome(s) → boolean',
    prompt:
      'Ignore case, and ignore anything that is not a letter or a digit. Does the '
      + 'string read the same both ways?\n\n'
      + 'The one-liner with a regex and a reverse is fine and you should write it. '
      + 'Then write the two-pointer version that allocates nothing — that is the one '
      + 'an interviewer is asking for.',
    starter: 'function isPalindrome(s) {\n  \n}\n',
    tests: [
      { args: ['A man, a plan, a canal: Panama'], expect: true },
      { args: ['race a car'], expect: false },
      { args: [''], expect: true },
      // Nothing but punctuation reduces to the empty string, which is a
      // palindrome. An early `if (!s) return` on the RAW string misses it.
      { args: ['.,;!'], expect: true, hidden: true },
      { args: ['0P'], expect: false, hidden: true },
    ],
    hint: 'Two indices walking inwards. Skip anything that fails /[a-z0-9]/i, compare the rest lowercased.',
    solution:
      'function isPalindrome(s) {\n'
      + '  const ok = c => /[a-z0-9]/i.test(c);\n'
      + '  let i = 0, j = s.length - 1;\n'
      + '  while (i < j) {\n'
      + '    while (i < j && !ok(s[i])) i++;\n'
      + '    while (i < j && !ok(s[j])) j--;\n'
      + '    if (s[i].toLowerCase() !== s[j].toLowerCase()) return false;\n'
      + '    i++; j--;\n'
      + '  }\n'
      + '  return true;\n'
      + '}',
  }),

  P({
    slug: 'longest-unique',
    title: 'Longest stretch with no repeats',
    difficulty: 'Medium',
    topic: 'Strings',
    pattern: 'Sliding window',
    lc: 'longest-substring-without-repeating-characters',
    fnName: 'longestUnique',
    signature: 'longestUnique(s) → number',
    prompt:
      'Return the length of the longest run of characters containing no repeats.\n\n'
      + 'A window that grows on the right and shrinks on the left. The subtlety is '
      + 'how far left to jump when you hit a repeat: past the previous copy, and '
      + 'never backwards.',
    starter: 'function longestUnique(s) {\n  \n}\n',
    tests: [
      { args: ['abcabcbb'], expect: 3 },
      { args: ['bbbbb'], expect: 1 },
      { args: ['pwwkew'], expect: 3 },
      { args: [''], expect: 0 },
      // "tmmzuxt": the final t's previous index is 0, long behind the
      // window. Jumping to it without a max() drags the window backwards
      // and returns 6 instead of 5.
      { args: ['tmmzuxt'], expect: 5, hidden: true },
      { args: ['abba'], expect: 2, hidden: true },
    ],
    hint: 'Map each character to its last index. left = Math.max(left, lastIndex + 1) — the max is the whole puzzle.',
    solution:
      'function longestUnique(s) {\n'
      + '  const last = new Map();\n'
      + '  let left = 0, best = 0;\n'
      + '  for (let i = 0; i < s.length; i++) {\n'
      + '    const c = s[i];\n'
      + '    if (last.has(c)) left = Math.max(left, last.get(c) + 1);\n'
      + '    last.set(c, i);\n'
      + '    best = Math.max(best, i - left + 1);\n'
      + '  }\n'
      + '  return best;\n'
      + '}',
  }),

  P({
    slug: 'balanced-brackets',
    title: 'Balanced brackets',
    difficulty: 'Easy',
    topic: 'Stacks',
    pattern: 'Stack',
    lc: 'valid-parentheses',
    fnName: 'isBalanced',
    signature: 'isBalanced(s) → boolean',
    prompt:
      'The string contains only ( ) [ ] { }. Return true if every bracket is closed '
      + 'by the right kind, in the right order.\n\n'
      + 'Counting will not do it: "([)]" has the right totals and is still wrong. '
      + 'Order is the thing being checked, and order is what a stack remembers.',
    starter: 'function isBalanced(s) {\n  \n}\n',
    tests: [
      { args: ['()'], expect: true },
      { args: ['()[]{}'], expect: true },
      { args: ['(]'], expect: false },
      { args: ['([)]'], expect: false },
      { args: ['{[]}'], expect: true },
      // Closer first: popping an empty stack must fail, not crash.
      { args: [']'], expect: false, hidden: true },
      // Left open at the end: the stack has to be empty to pass.
      { args: ['((('], expect: false, hidden: true },
    ],
    hint: 'Push openers. On a closer, the top of the stack must be its partner — pop it. At the end the stack must be empty.',
    solution:
      'function isBalanced(s) {\n'
      + '  const pair = { ")": "(", "]": "[", "}": "{" };\n'
      + '  const st = [];\n'
      + '  for (const c of s) {\n'
      + '    if (pair[c]) { if (st.pop() !== pair[c]) return false; }\n'
      + '    else st.push(c);\n'
      + '  }\n'
      + '  return st.length === 0;\n'
      + '}',
  }),

  P({
    slug: 'binary-search',
    title: 'Binary search',
    difficulty: 'Easy',
    topic: 'Binary search',
    pattern: 'Classic bisect',
    lc: 'binary-search',
    fnName: 'search',
    signature: 'search(nums, target) → index | -1',
    prompt:
      'nums is sorted ascending with no duplicates. Return the index of target, or '
      + '−1.\n\n'
      + 'Everyone knows the idea. Almost nobody writes it right first time — the bugs '
      + 'live in the loop condition and in what happens to lo and hi after the '
      + 'comparison. Get the empty array and the not-found case right too.',
    starter: 'function search(nums, target) {\n  \n}\n',
    tests: [
      { args: [[-1, 0, 3, 5, 9, 12], 9], expect: 4 },
      { args: [[-1, 0, 3, 5, 9, 12], 2], expect: -1 },
      { args: [[5], 5], expect: 0 },
      { args: [[], 1], expect: -1, hidden: true },
      // Two elements, target at the end: the case `while (lo < hi)` with
      // a floor midpoint loops forever on.
      { args: [[1, 2], 2], expect: 1, hidden: true },
      { args: [[1, 3, 5, 7], 7], expect: 3, hidden: true },
    ],
    hint: 'while (lo <= hi), mid = (lo + hi) >> 1, and move lo to mid + 1 or hi to mid − 1 — never to mid, or it never terminates.',
    solution:
      'function search(nums, target) {\n'
      + '  let lo = 0, hi = nums.length - 1;\n'
      + '  while (lo <= hi) {\n'
      + '    const mid = (lo + hi) >> 1;\n'
      + '    if (nums[mid] === target) return mid;\n'
      + '    if (nums[mid] < target) lo = mid + 1; else hi = mid - 1;\n'
      + '  }\n'
      + '  return -1;\n'
      + '}',
  }),

  P({
    slug: 'merge-intervals',
    title: 'Merge overlapping intervals',
    difficulty: 'Medium',
    topic: 'Intervals',
    pattern: 'Sort then sweep',
    lc: 'merge-intervals',
    fnName: 'mergeIntervals',
    signature: 'mergeIntervals(intervals) → [[start, end], …]',
    prompt:
      'Merge every overlapping interval and return the result sorted by start. '
      + 'Intervals that touch — [1,4] and [4,5] — count as overlapping.\n\n'
      + 'The whole problem becomes easy the moment they are sorted, which is the '
      + 'lesson.',
    starter: 'function mergeIntervals(intervals) {\n  \n}\n',
    tests: [
      { args: [[[1, 3], [2, 6], [8, 10], [15, 18]]], expect: [[1, 6], [8, 10], [15, 18]] },
      { args: [[[1, 4], [4, 5]]], expect: [[1, 5]] },
      { args: [[]], expect: [] },
      // Arrives out of order — a solution that skips the sort passes the
      // first two cases and fails this one.
      { args: [[[5, 6], [1, 3], [2, 4]]], expect: [[1, 4], [5, 6]], hidden: true },
      // Fully contained: the end must be a max(), not just "the later one".
      { args: [[[1, 10], [2, 3]]], expect: [[1, 10]], hidden: true },
    ],
    hint: 'Sort by start. Walk: if this start ≤ the last end, extend that end to max(lastEnd, thisEnd); otherwise push a new one.',
    solution:
      'function mergeIntervals(intervals) {\n'
      + '  const s = intervals.slice().sort((a, b) => a[0] - b[0]);\n'
      + '  const out = [];\n'
      + '  for (const [start, end] of s) {\n'
      + '    const last = out[out.length - 1];\n'
      + '    if (last && start <= last[1]) last[1] = Math.max(last[1], end);\n'
      + '    else out.push([start, end]);\n'
      + '  }\n'
      + '  return out;\n'
      + '}',
  }),

  P({
    slug: 'climb-ways',
    title: 'Ways up the stairs',
    difficulty: 'Easy',
    topic: 'DP',
    pattern: 'Fibonacci',
    lc: 'climbing-stairs',
    fnName: 'climbWays',
    signature: 'climbWays(n) → number',
    prompt:
      'You take 1 or 2 steps at a time. How many distinct ways are there to climb '
      + 'n steps?\n\n'
      + 'Write the recursion first and watch it die around n = 40. Then notice you '
      + 'only ever need the last two answers, and the whole thing becomes two '
      + 'variables — which is what makes n = 45 instant.',
    starter: 'function climbWays(n) {\n  \n}\n',
    tests: [
      { args: [2], expect: 2 },
      { args: [3], expect: 3 },
      { args: [5], expect: 8 },
      { args: [1], expect: 1, hidden: true },
      // Naive recursion takes minutes here and the runner kills it at
      // 2.5s. That timeout IS the lesson.
      { args: [45], expect: 1836311903, hidden: true },
    ],
    hint: 'ways(n) = ways(n−1) + ways(n−2). Iterate with two variables instead of recursing.',
    solution:
      'function climbWays(n) {\n'
      + '  let a = 1, b = 1;\n'
      + '  for (let i = 2; i <= n; i++) { const c = a + b; a = b; b = c; }\n'
      + '  return b;\n'
      + '}',
  }),

  P({
    slug: 'coin-change',
    title: 'Fewest coins',
    difficulty: 'Medium',
    topic: 'DP',
    pattern: 'Unbounded knapsack',
    lc: 'coin-change',
    fnName: 'coinChange',
    signature: 'coinChange(coins, amount) → number | -1',
    prompt:
      'Unlimited coins of each denomination. Return the fewest needed to make the '
      + 'amount exactly, or −1 if it cannot be done.\n\n'
      + 'Greedy — always take the biggest coin that fits — is the obvious answer and '
      + 'it is wrong. One of the hidden cases is there to prove it to you.',
    starter: 'function coinChange(coins, amount) {\n  \n}\n',
    tests: [
      { args: [[1, 2, 5], 11], expect: 3 },
      { args: [[2], 3], expect: -1 },
      { args: [[1], 0], expect: 0 },
      // Greedy takes 25+1+1+1+1 = 5 coins. The answer is 20+20 = 2.
      { args: [[1, 15, 25], 30], expect: 2, hidden: true },
      { args: [[186, 419, 83, 408], 6249], expect: 20, hidden: true },
    ],
    hint: 'best[x] = 1 + min(best[x − coin]) over every coin that fits. Build it upwards from 0, seeded with best[0] = 0.',
    solution:
      'function coinChange(coins, amount) {\n'
      + '  const best = new Array(amount + 1).fill(Infinity);\n'
      + '  best[0] = 0;\n'
      + '  for (let x = 1; x <= amount; x++) {\n'
      + '    for (const c of coins) {\n'
      + '      if (c <= x && best[x - c] + 1 < best[x]) best[x] = best[x - c] + 1;\n'
      + '    }\n'
      + '  }\n'
      + '  return best[amount] === Infinity ? -1 : best[amount];\n'
      + '}',
  }),

  P({
    slug: 'count-bits',
    title: 'Set bits up to n',
    difficulty: 'Easy',
    topic: 'Bit manipulation',
    pattern: 'DP on bits',
    lc: 'counting-bits',
    fnName: 'countBits',
    signature: 'countBits(n) → number[]',
    prompt:
      'Return an array of length n + 1 where out[i] is the number of 1 bits in i.\n\n'
      + 'Counting each number\'s bits separately works. Better: i has the same bits '
      + 'as i >> 1, plus one more if i is odd — so every answer is one lookup and '
      + 'one addition away from an answer you already have.',
    starter: 'function countBits(n) {\n  \n}\n',
    tests: [
      { args: [2], expect: [0, 1, 1] },
      { args: [5], expect: [0, 1, 1, 2, 1, 2] },
      // n = 0 still returns one entry, not none.
      { args: [0], expect: [0], hidden: true },
      { args: [8], expect: [0, 1, 1, 2, 1, 2, 2, 3, 1], hidden: true },
    ],
    hint: 'out[i] = out[i >> 1] + (i & 1).',
    solution:
      'function countBits(n) {\n'
      + '  const out = new Array(n + 1).fill(0);\n'
      + '  for (let i = 1; i <= n; i++) out[i] = out[i >> 1] + (i & 1);\n'
      + '  return out;\n'
      + '}',
  }),
];

export const codePuzzleById = id => CODE_PUZZLES.find(p => p.id === id) || null;

/** Topics present, for the filter row. */
export const CODE_TOPICS = [...new Set(CODE_PUZZLES.map(p => p.topic))];
