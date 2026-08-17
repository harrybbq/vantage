/**
 * A KQL subset, evaluated in the browser.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * The KQL exercises used to end at "here is one correct answer, compare
 * it to yours yourself". That is the weakest possible form of practice:
 * reading a solution and feeling that you would have written it is not
 * the same as having written it, and there is no moment where you are
 * told you are wrong. Running the query against real rows and checking
 * the output is that moment.
 *
 * Sentinel is not reachable from a browser, and would cost money and
 * credentials if it were. So the tables are bundled (see
 * data/kqlTables.js) and this file is the engine.
 *
 * ── What it is NOT ───────────────────────────────────────────────────
 * It is not KQL. It is the slice of KQL these exercises need, and it
 * says so out loud: an unsupported operator raises "this runner doesn't
 * support X" rather than quietly returning something plausible. A
 * teaching tool that is subtly wrong is worse than one that is
 * obviously limited, because you learn the wrong thing and only find
 * out in front of a real cluster.
 *
 * Supported:
 *   Table
 *   | where <expr>
 *   | extend name = <expr>, …
 *   | project name, alias = <expr>, …
 *   | project-away name, …
 *   | summarize name = agg(…), … [by col, …]
 *   | order by col [asc|desc], …          (sort by is a synonym)
 *   | top N by col [asc|desc]
 *   | take N                              (limit is a synonym)
 *   | distinct col, …
 *   | count
 *   | join kind=<inner|innerunique|leftouter|leftanti|leftsemi> T on keys
 *   | union T, (T | …)
 *   | serialize / | render                (accepted, no effect here)
 *   let name = <expr>;                    scalar
 *   let name = <pipeline>;                table — how joins are written
 *
 * Aggregations: count(), countif(x), dcount(x), sum(x), avg(x), min(x),
 * max(x), any(x), make_set(x), make_list(x), stdev(x), stdevp(x).
 * Scalars: ago, now, bin, startofday, datetime_diff, tostring, toint,
 * todouble, tolower, toupper, strcat, strlen, split, extract, isempty,
 * isnotempty, isnull, isnotnull, array_length, abs, floor, round, iff,
 * case, coalesce, parse_json.
 * Row functions: prev(col[, n]), next(col[, n]).
 * Operators: == != =~ !~ < <= > >= + - * / %, and/or/not, contains,
 * !contains, has, !has, has_any, has_all, startswith, endswith,
 * matches regex, in (…), in~ (…), !in (…), between (a .. b).
 *
 * NOT supported, deliberately: mv-expand, parse, externaldata,
 * make-series, top-nested, percentiles. Thirteen of the twenty-four
 * bundled exercises use one of those; the UI marks them "not checkable
 * here" and names the reason, rather than pretending otherwise. Which
 * exercises those are is DERIVED — the panel runs each reference answer
 * and sees what happens — so the list cannot drift from the engine.
 *
 * The default join kind is `innerunique`, matching real Kusto: it
 * dedupes the LEFT side on the key first. It surprises everyone once.
 * Reproducing it here is the point.
 *
 * Pure: no DOM, no network, no clock of its own. `now` is passed in, so
 * the same query over the same tables always gives the same answer —
 * which is what lets an exercise have a fixed expected result.
 */

/* ══ Errors ═══════════════════════════════════════════════════════════ */

export class KqlError extends Error {
  constructor(message, at) {
    super(message);
    this.name = 'KqlError';
    this.at = at;                       // token index, when known
  }
}

const die = (msg, at) => { throw new KqlError(msg, at); };

/* Key separator for grouping and row comparison. A NUL cannot appear in
   any value these tables hold, so two different key tuples can never
   collide the way "a|b" and "a" + "|b" would with a printable one. */
const SEP = '\u0000';

/* ══ Lexer ════════════════════════════════════════════════════════════ */

const PUNCT = ['<=', '>=', '==', '!=', '=~', '!~', '..', '(', ')', ',', '=', '<', '>', '+', '-', '*', '/', '%', '.', '$', '~'];

const TIMESPAN_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;
const MS_PER = { ms: 1, s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 };

/** A timespan is a plain number of milliseconds, tagged so arithmetic
 *  against a date does the right thing without a second value type. */
class Timespan {
  constructor(ms) { this.ms = ms; }
  valueOf() { return this.ms; }
}
export const isTimespan = v => v instanceof Timespan;

export function tokenise(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === '/' && src[i + 1] === '/') {            // line comment
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }

    // @"…" is a verbatim string: backslashes are literal, which is why
    // every Windows path and regex in a real query is written this way.
    if (c === '@' && (src[i + 1] === '"' || src[i + 1] === "'")) {
      const quote = src[i + 1];
      let j = i + 2, val = '';
      while (j < src.length && src[j] !== quote) val += src[j++];
      if (j >= src.length) die('Unterminated string.');
      out.push({ t: 'str', v: val, i });
      i = j + 1;
      continue;
    }

    if (c === "'" || c === '"') {                     // string
      const quote = c;
      let j = i + 1, val = '';
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < src.length) { val += src[j + 1]; j += 2; continue; }
        val += src[j++];
      }
      if (j >= src.length) die('Unterminated string.');
      out.push({ t: 'str', v: val, i });
      i = j + 1;
      continue;
    }

    if (c === '|') { out.push({ t: 'pipe', v: '|', i }); i++; continue; }
    if (c === ';') { out.push({ t: 'semi', v: ';', i }); i++; continue; }
    if (c === '[') { out.push({ t: 'punct', v: '[', i }); i++; continue; }
    if (c === ']') { out.push({ t: 'punct', v: ']', i }); i++; continue; }

    if (/[0-9]/.test(c)) {                            // number or timespan
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      let k = j;
      while (k < src.length && /[a-z]/i.test(src[k])) k++;
      const withUnit = src.slice(i, k);
      const m = TIMESPAN_RE.exec(withUnit);
      if (m) {
        out.push({ t: 'timespan', v: Number(m[1]) * MS_PER[m[2]], i });
        i = k;
      } else {
        out.push({ t: 'num', v: Number(src.slice(i, j)), i });
        i = j;
      }
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {                        // identifier / keyword
      let j = i;
      while (j < src.length && /[A-Za-z0-9_-]/.test(src[j])) j++;
      // `project-away` and `mv-expand` are hyphenated; a bare trailing
      // hyphen is not part of a name.
      let word = src.slice(i, j).replace(/-+$/, '');
      out.push({ t: 'ident', v: word, i });
      i = i + word.length;
      continue;
    }

    if (c === '!') {                                  // !=, !~, !contains, !in
      if (src[i + 1] === '=') { out.push({ t: 'punct', v: '!=', i }); i += 2; continue; }
      if (src[i + 1] === '~') { out.push({ t: 'punct', v: '!~', i }); i += 2; continue; }
      let j = i + 1;
      while (j < src.length && /[a-z_]/i.test(src[j])) j++;
      if (j > i + 1) { out.push({ t: 'ident', v: '!' + src.slice(i + 1, j).toLowerCase(), i }); i = j; continue; }
      die(`Unexpected "!" at ${i}.`, i);
    }

    const p = PUNCT.find(sym => src.startsWith(sym, i));
    if (p) { out.push({ t: 'punct', v: p, i }); i += p.length; continue; }

    die(`I don't understand "${c}" at position ${i}.`, i);
  }
  out.push({ t: 'end', v: null, i: src.length });
  return out;
}

/* ══ Expression parser ════════════════════════════════════════════════
 *
 * Recursive descent producing a closure (row, env) => value. Compiling
 * once and calling per row rather than walking a tree per row — a
 * summarize over a few thousand rows calls these a lot.
 */

const BINARY_STR_OPS = new Set(['contains', '!contains', 'has', '!has',
  'startswith', 'endswith', 'in', '!in', 'matches', 'has_any', 'has_all']);

/** Operators whose right-hand side is a bracketed list, not one value. */
const LIST_OPS = new Set(['in', '!in', 'has_any', 'has_all']);

class Parser {
  constructor(tokens) { this.k = tokens; this.p = 0; }
  peek(n = 0) { return this.k[this.p + n]; }
  next() { return this.k[this.p++]; }
  atIdent(word) {
    const t = this.peek();
    return t.t === 'ident' && t.v.toLowerCase() === word;
  }
  eatIdent(word) { if (this.atIdent(word)) { this.p++; return true; } return false; }
  atPunct(v) { const t = this.peek(); return t.t === 'punct' && t.v === v; }
  eatPunct(v) { if (this.atPunct(v)) { this.p++; return true; } return false; }
  expectPunct(v) { if (!this.eatPunct(v)) die(`Expected "${v}".`, this.peek().i); }

  /* or > and > not > comparison > additive > multiplicative > unary > primary */

  parseExpr() { return this.parseOr(); }

  parseOr() {
    let left = this.parseAnd();
    while (this.atIdent('or')) {
      this.p++;
      const right = this.parseAnd();
      const l = left;
      left = (r, e) => truthy(l(r, e)) || truthy(right(r, e));
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.atIdent('and')) {
      this.p++;
      const right = this.parseNot();
      const l = left;
      left = (r, e) => truthy(l(r, e)) && truthy(right(r, e));
    }
    return left;
  }

  parseNot() {
    if (this.atIdent('not')) {
      this.p++;
      // `not(x)` and `not x` are both written in the wild.
      const inner = this.parseNot();
      return (r, e) => !truthy(inner(r, e));
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseAdditive();
    for (;;) {
      const t = this.peek();

      if (t.t === 'punct' && ['==', '!=', '=~', '!~', '<', '<=', '>', '>='].includes(t.v)) {
        this.p++;
        const right = this.parseAdditive();
        const l = left, op = t.v;
        left = (r, e) => compare(op, l(r, e), right(r, e));
        continue;
      }

      if (t.t === 'ident' && BINARY_STR_OPS.has(t.v.toLowerCase())) {
        const op = t.v.toLowerCase();
        this.p++;
        if (LIST_OPS.has(op)) {
          // `in~` is the case-insensitive form; the tilde is its own
          // token because an identifier cannot contain one.
          const fold = this.eatPunct('~');
          this.expectPunct('(');
          const items = [];
          if (!this.atPunct(')')) {
            do { items.push(this.parseExpr()); } while (this.eatPunct(','));
          }
          this.expectPunct(')');
          const l = left;
          const norm = v => (fold ? str(v).toLowerCase() : v);
          left = (r, e) => {
            const v = l(r, e);
            if (op === 'has_any' || op === 'has_all') {
              // Term membership, like `has`, against a list of needles.
              const terms = new Set(str(v).toLowerCase().split(/[^a-z0-9]+/i));
              const need = items.map(f => str(f(r, e)).toLowerCase());
              return op === 'has_any' ? need.some(n => terms.has(n)) : need.every(n => terms.has(n));
            }
            const hit = items.some(f => looseEq(norm(f(r, e)), norm(v)));
            return op === 'in' ? hit : !hit;
          };
          continue;
        }
        if (op === 'matches') {
          if (!this.eatIdent('regex')) die('Expected "regex" after "matches".', this.peek().i);
          const right = this.parseAdditive();
          const l = left;
          left = (r, e) => new RegExp(String(right(r, e))).test(str(l(r, e)));
          continue;
        }
        const right = this.parseAdditive();
        const l = left;
        left = (r, e) => strOp(op, l(r, e), right(r, e));
        continue;
      }

      if (t.t === 'ident' && t.v.toLowerCase() === 'between') {
        this.p++;
        this.expectPunct('(');
        const lo = this.parseAdditive();
        this.expectPunct('..');
        const hi = this.parseAdditive();
        this.expectPunct(')');
        const l = left;
        left = (r, e) => {
          const v = num(l(r, e));
          return v >= num(lo(r, e)) && v <= num(hi(r, e));
        };
        continue;
      }

      return left;
    }
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.t === 'punct' && (t.v === '+' || t.v === '-')) {
        this.p++;
        const right = this.parseMultiplicative();
        const l = left, op = t.v;
        left = (r, e) => arith(op, l(r, e), right(r, e));
        continue;
      }
      return left;
    }
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.t === 'punct' && ['*', '/', '%'].includes(t.v)) {
        this.p++;
        const right = this.parseUnary();
        const l = left, op = t.v;
        left = (r, e) => arith(op, l(r, e), right(r, e));
        continue;
      }
      return left;
    }
  }

  parseUnary() {
    if (this.eatPunct('-')) {
      const inner = this.parseUnary();
      return (r, e) => -num(inner(r, e));
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.next();

    if (t.t === 'num') return () => t.v;
    if (t.t === 'str') return () => t.v;
    if (t.t === 'timespan') return () => new Timespan(t.v);

    if (t.t === 'punct' && t.v === '(') {
      const inner = this.parseExpr();
      this.expectPunct(')');
      return inner;
    }

    if (t.t === 'ident') {
      const name = t.v;
      const lower = name.toLowerCase();

      if (lower === 'true') return () => true;
      if (lower === 'false') return () => false;
      if (lower === 'null') return () => null;

      if (this.atPunct('(')) {
        this.p++;

        /* prev()/next() are ROW-relative, not value-relative: they need
           the neighbouring row, which the compiled-closure form cannot
           reach. So they are read as a column name plus an optional
           offset here, and served from the row array the executor puts
           on the environment. */
        if (lower === 'prev' || lower === 'next') {
          const col = this.next();
          if (col.t !== 'ident') die(`${name}() takes a column name.`, col.i);
          let offset = 1;
          if (this.eatPunct(',')) {
            const n = this.next();
            if (n.t !== 'num') die(`${name}()'s second argument is how many rows back.`, n.i);
            offset = n.v;
          }
          this.expectPunct(')');
          const dir = lower === 'prev' ? -1 : 1;
          return (r, e) => {
            if (!e || !e.rows) return null;
            const other = e.rows[e.i + dir * offset];
            return other ? other[col.v] : null;
          };
        }

        const args = [];
        if (!this.atPunct(')')) {
          do { args.push(this.parseExpr()); } while (this.eatPunct(','));
        }
        this.expectPunct(')');
        return this.makeCall(lower, name, args, t.i);
      }

      // Dotted access, for the nested columns real Sentinel tables have
      // (LocationDetails.countryOrRegion).
      const path = [name];
      while (this.atPunct('.')) {
        this.p++;
        const seg = this.next();
        if (seg.t !== 'ident' && seg.t !== 'str') die('Expected a field name after ".".', seg.i);
        path.push(seg.v);
      }
      if (path.length > 1) {
        return (r) => path.reduce((v, k) => (v == null ? undefined : v[k]), r);
      }
      return (r, e) => (name in r ? r[name] : (e && name in e.lets ? e.lets[name] : undefined));
    }

    die(`Unexpected ${t.t === 'end' ? 'end of query' : `"${t.v}"`}.`, t.i);
  }

  /** Scalar functions. Aggregations are handled by summarize, not here. */
  makeCall(lower, name, args, at) {
    const A = n => {
      if (args.length !== n) die(`${name}() takes ${n} argument${n === 1 ? '' : 's'}.`, at);
    };
    switch (lower) {
      case 'ago': A(1); return (r, e) => new Date(e.now.getTime() - num(args[0](r, e)));
      case 'now': return (r, e) => e.now;
      case 'tostring': A(1); return (r, e) => str(args[0](r, e));
      case 'tolower': A(1); return (r, e) => str(args[0](r, e)).toLowerCase();
      case 'toupper': A(1); return (r, e) => str(args[0](r, e)).toUpperCase();
      case 'toint': case 'tolong': A(1); return (r, e) => Math.trunc(num(args[0](r, e)));
      case 'todouble': case 'toreal': A(1); return (r, e) => num(args[0](r, e));
      case 'strlen': A(1); return (r, e) => str(args[0](r, e)).length;
      case 'strcat': return (r, e) => args.map(f => str(f(r, e))).join('');
      case 'isempty': A(1); return (r, e) => { const v = args[0](r, e); return v == null || v === ''; };
      case 'isnotempty': A(1); return (r, e) => { const v = args[0](r, e); return !(v == null || v === ''); };
      case 'isnull': A(1); return (r, e) => args[0](r, e) == null;
      case 'array_length': A(1); return (r, e) => { const v = args[0](r, e); return Array.isArray(v) ? v.length : 0; };
      case 'abs': A(1); return (r, e) => Math.abs(num(args[0](r, e)));
      case 'floor': A(1); return (r, e) => Math.floor(num(args[0](r, e)));
      case 'round': A(1); return (r, e) => Math.round(num(args[0](r, e)));
      case 'bin': case 'floor_time': {
        A(2);
        // Rounds a value (or a time) DOWN to a multiple of the second
        // argument — the standard way KQL buckets a timeline.
        return (r, e) => {
          const v = args[0](r, e), step = num(args[1](r, e));
          if (!step) return v;
          if (v instanceof Date) return new Date(Math.floor(v.getTime() / step) * step);
          return Math.floor(num(v) / step) * step;
        };
      }
      case 'iff': case 'iif': A(3); return (r, e) => (truthy(args[0](r, e)) ? args[1](r, e) : args[2](r, e));
      case 'coalesce': return (r, e) => { for (const f of args) { const v = f(r, e); if (v != null) return v; } return null; };
      case 'isnotnull': A(1); return (r, e) => args[0](r, e) != null;
      // The fixtures store dynamic columns as real objects already, so
      // parse_json is the identity for anything that is not a string.
      // Queries written the production way therefore run unchanged.
      case 'parse_json': case 'todynamic': A(1); return (r, e) => {
        const v = args[0](r, e);
        if (typeof v !== 'string') return v;
        try { return JSON.parse(v); } catch { return null; }
      };
      case 'datetime_diff': {
        A(3);
        // datetime_diff(unit, later, earlier) — note the order, which
        // is the reverse of what subtraction reads like and is where
        // the sign errors come from.
        const UNIT = {
          millisecond: 1, second: 1e3, minute: 6e4, hour: 3.6e6,
          day: 8.64e7, week: 6.048e8,
        };
        return (r, e) => {
          const unit = str(args[0](r, e)).toLowerCase();
          const per = UNIT[unit];
          if (!per) die(`datetime_diff doesn't know the unit "${unit}".`, at);
          return Math.trunc((num(args[1](r, e)) - num(args[2](r, e))) / per);
        };
      }
      case 'extract': {
        if (args.length < 3 || args.length > 4) die('extract(regex, captureIndex, text) takes three arguments.', at);
        return (r, e) => {
          const re = new RegExp(str(args[0](r, e)));
          const idx = Math.trunc(num(args[1](r, e)));
          const m = re.exec(str(args[2](r, e)));
          return m ? (m[idx] ?? null) : null;
        };
      }
      case 'split': {
        if (args.length < 2) die('split(text, separator) takes two arguments.', at);
        return (r, e) => str(args[0](r, e)).split(str(args[1](r, e)));
      }
      case 'startofday': A(1); return (r, e) => {
        const v = args[0](r, e);
        const d = v instanceof Date ? v : new Date(num(v));
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      };
      case 'case': {
        // case(cond1, val1, cond2, val2, …, otherwise) — pairs, then a
        // final fallback. An even count means the fallback is missing,
        // which silently returns null in some engines; say so instead.
        if (args.length < 3 || args.length % 2 === 0) {
          die('case() takes condition/value pairs and a final fallback: '
            + 'case(a, 1, b, 2, 0).', at);
        }
        return (r, e) => {
          for (let n = 0; n + 1 < args.length; n += 2) {
            if (truthy(args[n](r, e))) return args[n + 1](r, e);
          }
          return args[args.length - 1](r, e);
        };
      }
      default:
        die(`This runner doesn't support ${name}(). Supported: ago, now, bin, tostring, `
          + `toint, todouble, tolower, toupper, strcat, strlen, isempty, isnotempty, `
          + `isnull, array_length, abs, floor, round, iff, coalesce.`, at);
    }
  }
}

/* ══ Value helpers ════════════════════════════════════════════════════ */

const truthy = v => !!v && v !== 'false';
const str = v => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v));
const num = v => {
  if (v instanceof Date) return v.getTime();
  if (v instanceof Timespan) return v.ms;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};
const looseEq = (a, b) => {
  if (a instanceof Date || b instanceof Date) return num(a) === num(b);
  return a === b || (a != null && b != null && String(a) === String(b));
};

function compare(op, a, b) {
  if (op === '==') return looseEq(a, b);
  if (op === '!=') return !looseEq(a, b);
  // =~ and !~ are the case-INSENSITIVE pair. Worth having, because
  // "Administrator" == "administrator" being false is behind a good
  // proportion of hunting queries that quietly return nothing.
  if (op === '=~') return str(a).toLowerCase() === str(b).toLowerCase();
  if (op === '!~') return str(a).toLowerCase() !== str(b).toLowerCase();
  // Strings compare lexically; everything else numerically. Dates go
  // through num(), which is why `TimeGenerated > ago(24h)` works.
  const bothStrings = typeof a === 'string' && typeof b === 'string';
  const [x, y] = bothStrings ? [a, b] : [num(a), num(b)];
  switch (op) {
    case '<': return x < y;
    case '<=': return x <= y;
    case '>': return x > y;
    case '>=': return x >= y;
    default: return false;
  }
}

function arith(op, a, b) {
  // date − date is a timespan; date ± timespan is a date. Anything else
  // is plain arithmetic.
  if (a instanceof Date && b instanceof Date && op === '-') return new Timespan(a.getTime() - b.getTime());
  if (a instanceof Date && (op === '+' || op === '-')) {
    const d = num(b);
    return new Date(a.getTime() + (op === '+' ? d : -d));
  }
  const x = num(a), y = num(b);
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/': return y === 0 ? null : x / y;
    case '%': return y === 0 ? null : x % y;
    default: return null;
  }
}

function strOp(op, a, b) {
  const hay = str(a), needle = str(b);
  const H = hay.toLowerCase(), N = needle.toLowerCase();
  switch (op) {
    // KQL's `contains` is case-INSENSITIVE (contains_cs is the sensitive
    // one). Getting this backwards is the classic way a hunting query
    // silently misses half its hits.
    case 'contains': return H.includes(N);
    case '!contains': return !H.includes(N);
    case 'startswith': return H.startsWith(N);
    case 'endswith': return H.endsWith(N);
    // `has` matches a whole term, not a substring — "win" does not have
    // "windows". That distinction is most of why `has` is faster.
    case 'has': return H.split(/[^a-z0-9]+/i).includes(N);
    case '!has': return !H.split(/[^a-z0-9]+/i).includes(N);
    default: return false;
  }
}

const compileExpr = tokens => {
  const p = new Parser(tokens);
  const fn = p.parseExpr();
  if (p.peek().t !== 'end') die(`Unexpected "${p.peek().v}" — is an operator missing?`, p.peek().i);
  return fn;
};

/* ══ Aggregations ═════════════════════════════════════════════════════ */

const AGGS = {
  count: () => ({ init: () => 0, step: n => n + 1, done: n => n }),
  countif: arg => ({ init: () => 0, step: (n, r, e) => (truthy(arg(r, e)) ? n + 1 : n), done: n => n }),
  sum: arg => ({ init: () => 0, step: (n, r, e) => n + num(arg(r, e)), done: n => n }),
  avg: arg => ({
    init: () => ({ s: 0, n: 0 }),
    step: (a, r, e) => { const v = arg(r, e); if (v != null) { a.s += num(v); a.n++; } return a; },
    done: a => (a.n ? a.s / a.n : null),
  }),
  min: arg => ({
    init: () => null,
    step: (m, r, e) => { const v = arg(r, e); return m == null || (v != null && num(v) < num(m)) ? v : m; },
    done: m => m,
  }),
  max: arg => ({
    init: () => null,
    step: (m, r, e) => { const v = arg(r, e); return m == null || (v != null && num(v) > num(m)) ? v : m; },
    done: m => m,
  }),
  // Sample standard deviation (n − 1), which is what Kusto's stdev()
  // is — stdevp() is the population form and divides by n.
  stdev: arg => ({
    init: () => [],
    step: (l, r, e) => { const v = arg(r, e); if (v != null) l.push(num(v)); return l; },
    done: l => {
      if (l.length < 2) return null;
      const mean = l.reduce((a, b) => a + b, 0) / l.length;
      return Math.sqrt(l.reduce((a, b) => a + (b - mean) ** 2, 0) / (l.length - 1));
    },
  }),
  stdevp: arg => ({
    init: () => [],
    step: (l, r, e) => { const v = arg(r, e); if (v != null) l.push(num(v)); return l; },
    done: l => {
      if (!l.length) return null;
      const mean = l.reduce((a, b) => a + b, 0) / l.length;
      return Math.sqrt(l.reduce((a, b) => a + (b - mean) ** 2, 0) / l.length);
    },
  }),
  dcount: arg => ({
    init: () => new Set(),
    step: (s, r, e) => { const v = arg(r, e); if (v != null) s.add(str(v)); return s; },
    done: s => s.size,
  }),
  // any() picks an arbitrary value from the group. Real Kusto makes no
  // promise about WHICH, and neither does this — but it has to be
  // deterministic here or an exercise could pass and then fail, so it
  // is the first one seen.
  any: arg => ({
    init: () => ({ set: false, v: null }),
    step: (a, r, e) => { if (!a.set) { a.set = true; a.v = arg(r, e); } return a; },
    done: a => a.v,
  }),
  take_any: arg => ({
    init: () => ({ set: false, v: null }),
    step: (a, r, e) => { if (!a.set) { a.set = true; a.v = arg(r, e); } return a; },
    done: a => a.v,
  }),
  make_list: arg => ({
    init: () => [],
    step: (l, r, e) => { const v = arg(r, e); if (v != null) l.push(v); return l; },
    done: l => l,
  }),
  make_set: arg => ({
    init: () => new Set(),
    step: (s, r, e) => { const v = arg(r, e); if (v != null) s.add(str(v)); return s; },
    done: s => [...s].sort(),
  }),
};

/* ══ Splitting a query into its pieces ════════════════════════════════ */

/** Split token list on top-level pipes (parens/brackets protect). */
function splitPipes(tokens) {
  const parts = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.t === 'end') break;
    if (t.t === 'punct' && (t.v === '(' || t.v === '[')) depth++;
    if (t.t === 'punct' && (t.v === ')' || t.v === ']')) depth--;
    if (t.t === 'pipe' && depth === 0) { parts.push([]); continue; }
    parts[parts.length - 1].push(t);
  }
  return parts.map(p => [...p, { t: 'end', v: null, i: -1 }]);
}

/** Split on top-level commas, for `project a, b = c`. */
function splitCommas(tokens) {
  const parts = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.t === 'end') break;
    if (t.t === 'punct' && (t.v === '(' || t.v === '[')) depth++;
    if (t.t === 'punct' && (t.v === ')' || t.v === ']')) depth--;
    if (t.t === 'punct' && t.v === ',' && depth === 0) { parts.push([]); continue; }
    parts[parts.length - 1].push(t);
  }
  return parts.filter(p => p.length).map(p => [...p, { t: 'end', v: null, i: -1 }]);
}

/**
 * `name = expr` or bare `expr`.
 * Only a top-level `=` that is not part of ==, !=, <=, >= counts, and
 * splitPipes/splitCommas have already isolated one clause.
 */
function namedClause(tokens, fallbackName) {
  if (tokens.length > 2 && tokens[0].t === 'ident'
      && tokens[1].t === 'punct' && tokens[1].v === '=') {
    return { name: tokens[0].v, body: tokens.slice(2) };
  }
  // A bare column reference keeps its own name.
  if (tokens.length === 2 && tokens[0].t === 'ident') {
    return { name: tokens[0].v, body: tokens.slice(0, 1).concat(tokens[1]) };
  }
  return { name: fallbackName, body: tokens };
}

/**
 * A name for an expression nobody named.
 *
 * `bin(TimeGenerated, 1h)` and `tostring(LocationDetails.countryOrRegion)`
 * both want to keep the COLUMN's name — that is what the user is
 * grouping by, and it is what real KQL calls it. So: the first
 * identifier that isn't the function's own name, and only if there is
 * exactly one function wrapping it.
 */
function autoName(tokens) {
  const idents = tokens.filter(t => t.t === 'ident').map(t => t.v);
  if (!idents.length) return null;
  if (idents.length === 1) return idents[0];
  // Skip the leading call name(s); take the first thing that looks like
  // a column rather than a builtin.
  const known = new Set(['bin', 'tostring', 'tolower', 'toupper', 'toint',
    'tolong', 'todouble', 'toreal', 'floor', 'round', 'abs', 'strcat', 'coalesce']);
  const first = idents.find(v => !known.has(v.toLowerCase()));
  return first || idents[0];
}

/* ══ The pipeline ═════════════════════════════════════════════════════ */

/**
 * Run a query.
 *
 * @param query   the KQL text
 * @param tables  { TableName: [row, …] }
 * @param now     the clock ago()/now() answer to — passed in, never read
 *                from Date, so a query is reproducible
 * @returns {{columns: string[], rows: object[]}}
 * @throws  KqlError with a message written for the person typing
 */
export function runKql(query, tables, now = new Date()) {
  if (!query || !query.trim()) die('Nothing to run.');
  const all = tokenise(query);

  /*
   * Leading `let` statements.
   *
   * Two kinds, and telling them apart is what makes joins possible:
   * `let n = 10;` binds a VALUE, `let fails = SigninLogs | where …;`
   * binds a TABLE. A table-valued let is not an exotic feature — it is
   * how every non-trivial hunting query is written, because the thing
   * you join is almost never a bare table.
   */
  const lets = {};
  const scope = { ...tables };
  let rest = all;
  for (;;) {
    if (rest[0] && rest[0].t === 'ident' && rest[0].v.toLowerCase() === 'let') {
      const semi = findTopLevel(rest, t => t.t === 'semi');
      if (semi < 0) die('A "let" needs a ";" at the end.');
      const name = rest[1];
      if (!name || name.t !== 'ident') die('Expected a name after "let".');
      if (!(rest[2] && rest[2].t === 'punct' && rest[2].v === '=')) die('Expected "=" after the let name.');
      const bodyTokens = [...rest.slice(3, semi), { t: 'end', v: null, i: -1 }];

      const looksLikeTable = bodyTokens.some(t => t.t === 'pipe')
        || (bodyTokens[0].t === 'ident' && Object.prototype.hasOwnProperty.call(scope, bodyTokens[0].v)
            && bodyTokens[1] && bodyTokens[1].t === 'end');
      if (looksLikeTable) {
        scope[name.v] = execute(splitPipes(bodyTokens), scope, { now, lets }).rows;
      } else {
        lets[name.v] = compileExpr(bodyTokens)({}, { now, lets });
      }
      rest = rest.slice(semi + 1);
      continue;
    }
    break;
  }

  return execute(splitPipes(rest), scope, { now, lets });
}

/** Index of the first top-level token matching `pred` (parens protect). */
function findTopLevel(tokens, pred) {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === 'punct' && (t.v === '(' || t.v === '[')) depth++;
    if (t.t === 'punct' && (t.v === ')' || t.v === ']')) depth--;
    if (depth === 0 && pred(t)) return i;
  }
  return -1;
}

/**
 * Execute one pipeline.
 *
 * Split out from runKql so it can be re-entered for a table-valued let
 * and for a join's right-hand subquery — the same code path, so a
 * subquery cannot behave differently from the query it is inside.
 */
function execute(parts, scope, env0) {
  const env = { ...env0 };
  const head = parts[0];

  let rows, columns;

  if (head[0].t === 'ident' && head[0].v.toLowerCase() === 'union') {
    ({ rows, columns } = unionOf(head.slice(1), scope, env));
  } else if (head[0].t === 'ident' && head[0].v.toLowerCase() === 'materialize') {
    ({ rows, columns } = operandRows(head, scope, env).result);
  } else {
    if (head[0].t !== 'ident') die('A query starts with a table name.');
    const tableName = head[0].v;
    const table = scope[tableName];
    if (!table) {
      die(`There is no table called "${tableName}" here. Available: ${Object.keys(scope).join(', ')}.`);
    }
    if (head.length > 2) die(`Unexpected "${head[1].v}" after the table name — did you miss a "|"?`, head[1].i);
    rows = table.map(r => ({ ...r }));
    columns = table.length ? Object.keys(table[0]) : [];
  }

  for (const seg of parts.slice(1)) {
    if (seg.length <= 1) continue;                    // trailing pipe
    const op = seg[0].t === 'ident' ? seg[0].v.toLowerCase() : null;
    const body = seg.slice(1);
    const bodyEnded = [...body.slice(0, -1), { t: 'end', v: null, i: -1 }];

    switch (op) {
      case 'where': case 'filter': {
        const pred = compileExpr(bodyEnded);
        // prev()/next() read their neighbours off the environment. The
        // row array is the one BEFORE this operator ran, which is what
        // makes `where prev(User) == User` mean what it looks like.
        const src = rows;
        env.rows = src;
        rows = src.filter((r, i) => { env.i = i; return truthy(pred(r, env)); });
        break;
      }

      case 'extend': {
        const clauses = splitCommas(body).map(c => namedClause(c, null));
        for (const c of clauses) {
          if (!c.name) die('Every "extend" needs a name: extend total = a + b.');
          const fn = compileExpr(c.body);
          const src = rows;
          env.rows = src;
          rows = src.map((r, i) => { env.i = i; return { ...r, [c.name]: fn(r, env) }; });
          if (!columns.includes(c.name)) columns = [...columns, c.name];
        }
        break;
      }

      case 'project': {
        const clauses = splitCommas(body).map(c => namedClause(c, null));
        const compiled = clauses.map(c => {
          if (!c.name) die('Every projected column needs a name: project x = a + b.');
          return { name: c.name, fn: compileExpr(c.body) };
        });
        const src = rows;
        env.rows = src;
        rows = src.map((r, i) => {
          env.i = i;
          const out = {};
          for (const c of compiled) out[c.name] = c.fn(r, env);
          return out;
        });
        columns = compiled.map(c => c.name);
        break;
      }

      case 'project-away': {
        const drop = new Set(splitCommas(body).map(c => c[0].v));
        rows = rows.map(r => {
          const out = { ...r };
          for (const d of drop) delete out[d];
          return out;
        });
        columns = columns.filter(c => !drop.has(c));
        break;
      }

      case 'distinct': {
        const cols = splitCommas(body).map(c => c[0].v);
        const seen = new Set();
        const out = [];
        for (const r of rows) {
          const key = cols.map(c => str(r[c])).join(SEP);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(Object.fromEntries(cols.map(c => [c, r[c]])));
        }
        rows = out;
        columns = cols;
        break;
      }

      case 'summarize': {
        // Split the aggregation list from the `by` list.
        let byAt = -1, depth = 0;
        for (let n = 0; n < body.length; n++) {
          const t = body[n];
          if (t.t === 'punct' && (t.v === '(' || t.v === '[')) depth++;
          if (t.t === 'punct' && (t.v === ')' || t.v === ']')) depth--;
          if (depth === 0 && t.t === 'ident' && t.v.toLowerCase() === 'by') { byAt = n; break; }
        }
        const aggTokens = byAt < 0 ? body : body.slice(0, byAt);
        const byTokens = byAt < 0 ? [] : body.slice(byAt + 1);

        const byCols = splitCommas(byTokens).map(c => {
          const nc = namedClause(c, null);
          // `by bin(TimeGenerated, 1h)` is the normal way to bucket a
          // timeline and has no name of its own. KQL keeps the inner
          // column's name for it, so this does too — demanding
          // `by t = bin(...)` would have been the runner inventing a
          // rule the real language doesn't have.
          const name = nc.name || autoName(c);
          if (!name) die('Every "by" key needs a name — write it as "by name = expression".');
          return { name, fn: compileExpr(nc.body) };
        });

        const aggs = splitCommas(aggTokens).map(c => {
          const nc = namedClause(c, null);
          const t0 = nc.body[0];
          if (!t0 || t0.t !== 'ident' || !AGGS[t0.v.toLowerCase()]) {
            die(`"${t0 ? t0.v : '?'}" is not an aggregation this runner knows. `
              + `Supported: ${Object.keys(AGGS).join(', ')}.`, t0 && t0.i);
          }
          const fname = t0.v.toLowerCase();
          if (!(nc.body[1] && nc.body[1].t === 'punct' && nc.body[1].v === '(')) {
            die(`${fname} needs brackets: ${fname}().`, t0.i);
          }
          // Everything between the outer brackets is the argument.
          let depth2 = 0, close = -1;
          for (let n = 1; n < nc.body.length; n++) {
            const t = nc.body[n];
            if (t.t === 'punct' && t.v === '(') depth2++;
            if (t.t === 'punct' && t.v === ')') { depth2--; if (!depth2) { close = n; break; } }
          }
          if (close < 0) die(`${fname}( is never closed.`, t0.i);
          const argTokens = nc.body.slice(2, close);
          const arg = argTokens.length ? compileExpr([...argTokens, { t: 'end', v: null, i: -1 }]) : null;
          if (fname !== 'count' && !arg) die(`${fname}() needs a column, e.g. ${fname}(Bytes).`, t0.i);
          // Default name matches KQL's: count(), dcount_User, sum_Bytes.
          const auto = fname === 'count' ? 'count_'
            : `${fname}_${argTokens.map(t => t.v).join('')}`;
          return { name: nc.name || auto, spec: AGGS[fname](arg) };
        });

        const groups = new Map();
        for (const r of rows) {
          const keyVals = byCols.map(b => b.fn(r, env));
          const key = keyVals.map(str).join(SEP);
          let g = groups.get(key);
          if (!g) {
            g = { keyVals, acc: aggs.map(a => a.spec.init()) };
            groups.set(key, g);
          }
          g.acc = g.acc.map((v, n) => aggs[n].spec.step(v, r, env));
        }

        rows = [...groups.values()].map(g => {
          const out = {};
          byCols.forEach((b, n) => { out[b.name] = g.keyVals[n]; });
          aggs.forEach((a, n) => { out[a.name] = a.spec.done(g.acc[n]); });
          return out;
        });
        columns = [...byCols.map(b => b.name), ...aggs.map(a => a.name)];
        break;
      }

      case 'order': case 'sort': {
        if (!(body[0] && body[0].t === 'ident' && body[0].v.toLowerCase() === 'by')) {
          die('Write it as "order by Column desc".', seg[0].i);
        }
        rows = applySort(rows, body.slice(1), env);
        break;
      }

      case 'top': {
        // top N by col [desc]
        const n = body[0];
        if (!n || n.t !== 'num') die('Write it as "top 10 by Count desc".', seg[0].i);
        if (!(body[1] && body[1].t === 'ident' && body[1].v.toLowerCase() === 'by')) {
          die('Write it as "top 10 by Count desc".', seg[0].i);
        }
        rows = applySort(rows, body.slice(2), env).slice(0, n.v);
        break;
      }

      case 'take': case 'limit': {
        const n = body[0];
        if (!n || n.t !== 'num') die(`"${op}" needs a number.`, seg[0].i);
        rows = rows.slice(0, n.v);
        break;
      }

      case 'count': {
        rows = [{ Count: rows.length }];
        columns = ['Count'];
        break;
      }

      case 'join': {
        const joined = doJoin({ rows, columns }, body, scope, env, seg[0].i);
        rows = joined.rows;
        columns = joined.columns;
        break;
      }

      case 'union': {
        const other = unionOf(body, scope, env);
        rows = [...rows, ...other.rows];
        columns = [...new Set([...columns, ...other.columns])];
        break;
      }

      // A no-op here. In real Kusto it fixes the row order so prev()/
      // next() are defined; this runner always has an order, so
      // accepting it silently is closer to right than refusing it.
      case 'serialize':
        break;

      // A visualisation directive. The runner shows a table either way,
      // so accepting it and saying nothing beats refusing a query that
      // is otherwise entirely correct.
      case 'render':
        break;

      case 'mv-expand': case 'parse': case 'evaluate':
      case 'make-series': case 'externaldata':
        die(`This runner doesn't support "${op}". It covers where, extend, project, `
          + 'project-away, summarize, distinct, order by, top, take, count, join and '
          + 'union — enough for the runnable exercises, and honest about the rest.', seg[0].i);
        break;

      default:
        die(`"${seg[0].v}" is not an operator this runner knows.`, seg[0].i);
    }
  }

  // Columns can go stale if a summarize produced nothing; fall back to
  // whatever the surviving rows actually have.
  if (rows.length) {
    const seen = new Set(columns);
    for (const k of Object.keys(rows[0])) if (!seen.has(k)) columns.push(k);
    columns = columns.filter(c => c in rows[0]);
  }
  return { columns, rows };
}

/* ══ join and union ═══════════════════════════════════════════════════ */

/**
 * The right-hand side of a join, or one operand of a union.
 * Either a name already in scope, or a parenthesised subquery.
 */
function operandRows(tokens, scope, env) {
  let t0 = tokens[0];
  if (!t0) die('Expected a table here.');
  // materialize(X) caches X in real Kusto and changes nothing about the
  // result. Unwrapping it means a query written the production way runs
  // here, which is the point.
  if (t0.t === 'ident' && t0.v.toLowerCase() === 'materialize'
      && tokens[1] && tokens[1].t === 'punct' && tokens[1].v === '(') {
    const inner = operandRows(tokens.slice(1), scope, env);
    return { result: inner.result, consumed: inner.consumed + 1 };
  }
  if (t0.t === 'punct' && t0.v === '(') {
    // Find the matching close, then run what is inside as its own query.
    let depth = 0, close = -1;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.t === 'punct' && t.v === '(') depth++;
      if (t.t === 'punct' && t.v === ')') { depth--; if (!depth) { close = i; break; } }
    }
    if (close < 0) die('This bracket is never closed.', t0.i);
    const inner = [...tokens.slice(1, close), { t: 'end', v: null, i: -1 }];
    return { result: execute(splitPipes(inner), scope, env), consumed: close + 1 };
  }
  if (t0.t !== 'ident') die('Expected a table name.', t0.i);
  const rows = scope[t0.v];
  if (!rows) die(`There is no table called "${t0.v}" here. Available: ${Object.keys(scope).join(', ')}.`, t0.i);
  return {
    result: { rows: rows.map(r => ({ ...r })), columns: rows.length ? Object.keys(rows[0]) : [] },
    consumed: 1,
  };
}

/** `union A, B, (C | where …)` — every operand appended. */
function unionOf(tokens, scope, env) {
  const body = tokens.filter(t => t.t !== 'end');
  if (!body.length) die('"union" needs at least one table.');
  const rows = [];
  let columns = [];
  let rest = body;
  for (;;) {
    const { result, consumed } = operandRows(rest, scope, env);
    rows.push(...result.rows);
    columns = [...new Set([...columns, ...result.columns])];
    rest = rest.slice(consumed);
    if (rest.length && rest[0].t === 'punct' && rest[0].v === ',') { rest = rest.slice(1); continue; }
    if (!rest.length) break;
    die(`Unexpected "${rest[0].v}" in the union.`, rest[0].i);
  }
  return { rows, columns };
}

/**
 * join kind=<kind> <table> on <keys>
 *
 * Keys are either a bare name — the same column on both sides — or the
 * explicit `$left.A == $right.B`.
 *
 * ── The default is innerunique, and that is not a typo ───────────────
 * Kusto's default join dedupes the LEFT side on the key before matching.
 * It surprises everyone once, usually as "why did my join lose rows",
 * and the fix is to write `kind=inner` and mean it. Faithfully
 * reproducing that is the point of practising here rather than finding
 * out against a real workspace.
 */
function doJoin(left, tokens, scope, env, at) {
  let body = tokens.filter(t => t.t !== 'end');
  let kind = 'innerunique';

  while (body.length && body[0].t === 'ident'
         && ['kind', 'hint'].includes(body[0].v.toLowerCase())) {
    const isKind = body[0].v.toLowerCase() === 'kind';
    if (!(body[1] && body[1].t === 'punct' && (body[1].v === '=' || body[1].v === '.'))) {
      die('Write it as "join kind=inner …".', at);
    }
    if (isKind) {
      const k = body[2];
      if (!k || k.t !== 'ident') die('Write it as "join kind=inner …".', at);
      kind = k.v.toLowerCase();
      body = body.slice(3);
    } else {
      // hint.* tunes the distributed execution and means nothing here.
      body = body.slice(4);
    }
  }

  const KINDS = ['inner', 'innerunique', 'leftouter', 'leftanti', 'leftsemi'];
  if (!KINDS.includes(kind)) {
    die(`This runner supports join kinds ${KINDS.join(', ')} — not "${kind}".`, at);
  }

  const { result: right, consumed } = operandRows(body, scope, env);
  let rest = body.slice(consumed);

  if (!(rest[0] && rest[0].t === 'ident' && rest[0].v.toLowerCase() === 'on')) {
    die('A join needs "on" and at least one key.', at);
  }
  rest = rest.slice(1);

  const keys = splitCommas([...rest, { t: 'end', v: null, i: -1 }]).map(c => {
    const t = c.filter(x => x.t !== 'end');
    // $left.A == $right.B
    if (t[0] && t[0].t === 'punct' && t[0].v === '$') {
      const names = t.filter(x => x.t === 'ident').map(x => x.v);
      const side = names[0] && names[0].toLowerCase();
      if (names.length !== 4 || side !== 'left') {
        die('Write an explicit key as "$left.Column == $right.Column".', t[0].i);
      }
      return { l: names[1], r: names[3] };
    }
    if (t.length !== 1 || t[0].t !== 'ident') {
      die('A join key is a column name, or "$left.A == $right.B".', t[0] && t[0].i);
    }
    return { l: t[0].v, r: t[0].v };
  });

  const keyOf = (row, side) => keys.map(k => cell(row[side === 'l' ? k.l : k.r])).join(SEP);

  const index = new Map();
  for (const r of right.rows) {
    const k = keyOf(r, 'r');
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(r);
  }

  // Right columns that collide with a left column get a "1" suffix, as
  // Kusto does — including the join keys themselves.
  const leftCols = new Set(left.columns);
  const rename = {};
  for (const c of right.columns) rename[c] = leftCols.has(c) ? `${c}1` : c;

  let source = left.rows;
  if (kind === 'innerunique') {
    const seen = new Set();
    source = source.filter(r => {
      const k = keyOf(r, 'l');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const out = [];
  for (const l of source) {
    const matches = index.get(keyOf(l, 'l')) || [];
    if (kind === 'leftanti') { if (!matches.length) out.push({ ...l }); continue; }
    if (kind === 'leftsemi') { if (matches.length) out.push({ ...l }); continue; }
    if (!matches.length) {
      if (kind === 'leftouter') {
        const row = { ...l };
        for (const c of right.columns) row[rename[c]] = null;
        out.push(row);
      }
      continue;
    }
    for (const r of matches) {
      const row = { ...l };
      for (const c of right.columns) row[rename[c]] = r[c];
      out.push(row);
    }
  }

  const columns = (kind === 'leftanti' || kind === 'leftsemi')
    ? left.columns
    : [...left.columns, ...right.columns.map(c => rename[c])];
  return { rows: out, columns };
}

function applySort(rows, tokens, env) {
  const keys = splitCommas(tokens).map(c => {
    const body = [...c];
    body.pop();                                   // drop the end marker
    let dir = 'desc';                             // KQL's default
    const last = body[body.length - 1];
    if (last && last.t === 'ident' && ['asc', 'desc'].includes(last.v.toLowerCase())) {
      dir = last.v.toLowerCase();
      body.pop();
    }
    return { fn: compileExpr([...body, { t: 'end', v: null, i: -1 }]), dir };
  });
  // Copy first: sort in place would mutate the caller's array on the
  // very first pipeline stage, where `rows` is still the source table.
  return rows.slice().sort((a, b) => {
    for (const k of keys) {
      const av = k.fn(a, env), bv = k.fn(b, env);
      let c;
      if (typeof av === 'string' && typeof bv === 'string') c = av < bv ? -1 : av > bv ? 1 : 0;
      else c = num(av) - num(bv);
      if (c) return k.dir === 'asc' ? c : -c;
    }
    return 0;
  });
}

/* ══ Comparing two results ════════════════════════════════════════════ */

/** Cell → a stable string, so 5 and "5" and a Date all compare sanely. */
const cell = v => {
  if (v == null) return '∅';
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Timespan) return `${v.ms}ms`;
  if (Array.isArray(v)) return '[' + v.map(cell).join(',') + ']';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  return String(v);
};

const rowKey = (r, cols) => cols.map(c => cell(r[c])).join(SEP);

/**
 * Does `got` match `want`?
 *
 * Column ORDER is ignored — `project a, b` and `project b, a` are the
 * same answer to the same question. Row order is only enforced when the
 * reference query sorts, which `ordered` carries; otherwise rows are
 * compared as a multiset, because an unsorted KQL result has no promised
 * order and failing someone for it would be teaching a superstition.
 */
export function compareResults(got, want, ordered) {
  const wantCols = [...want.columns].sort();
  const gotCols = [...got.columns].sort();
  if (wantCols.join('|') !== gotCols.join('|')) {
    return {
      pass: false,
      why: `Columns don't match. Expected ${wantCols.join(', ') || '(none)'} — got ${gotCols.join(', ') || '(none)'}.`,
    };
  }
  if (got.rows.length !== want.rows.length) {
    return {
      pass: false,
      why: `Expected ${want.rows.length} row${want.rows.length === 1 ? '' : 's'}, got ${got.rows.length}.`,
    };
  }
  // Same rows, ignoring order? Answering this FIRST is what lets the
  // two failures be told apart: "you have the wrong rows" and "you have
  // the right rows in the wrong order" are different problems, and
  // reporting an ordering fault for a row that simply holds different
  // numbers sends someone hunting for a sort they never got wrong.
  const bag = new Map();
  for (const r of want.rows) {
    const k = rowKey(r, wantCols);
    bag.set(k, (bag.get(k) || 0) + 1);
  }
  let sameSet = true;
  for (const r of got.rows) {
    const k = rowKey(r, wantCols);
    const n = bag.get(k);
    if (!n) { sameSet = false; break; }
    bag.set(k, n - 1);
  }
  if (!sameSet) return { pass: false, why: 'The right number of rows, but not the right ones.' };
  if (!ordered) return { pass: true };

  for (let i = 0; i < want.rows.length; i++) {
    if (rowKey(got.rows[i], wantCols) !== rowKey(want.rows[i], wantCols)) {
      return { pass: false, why: `The right rows, but row ${i + 1} is out of order — this one is sorted.` };
    }
  }
  return { pass: true };
}

/** Whether a query promises an order — decides how strictly we compare. */
export const queryIsOrdered = q => /\|\s*(order|sort)\s+by\b|\|\s*top\s+\d/i.test(q || '');
