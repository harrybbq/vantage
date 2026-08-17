/**
 * The editors and their run buttons — JavaScript and KQL.
 *
 * Both follow the same shape, because they are answering the same
 * question: you wrote something, is it right? Type, press Run, get told.
 * The difference is only in what "right" means — passing test cases for
 * JS, matching the reference query's result for KQL.
 *
 * ── Why not a real code editor ───────────────────────────────────────
 * CodeMirror or Monaco would bring syntax highlighting and about 300 kB
 * of it. The bundle is already over the size warning, this is an
 * owner-only page, and a textarea with tab-to-indent covers writing
 * twenty lines of a solution. If it ever feels cramped, that is the
 * moment to pay the 300 kB — not before.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { canRun, runJs } from '../../lib/career/runner';
import { KqlError, compareResults, queryIsOrdered, runKql } from '../../lib/career/kql';
import { RESULT_TYPES, TABLE_SCHEMA, buildTables } from '../../data/kqlTables';

/* ══ Editor ═══════════════════════════════════════════════════════════ */

/**
 * A textarea that behaves enough like an editor.
 *
 * Tab inserts two spaces instead of leaving the field — in a box whose
 * entire purpose is writing indented code, the browser default is
 * actively wrong. Escape still moves focus on, so the keyboard is not a
 * trap: that is the accessibility rule this would otherwise break.
 */
function CodeEditor({ value, onChange, rows = 12, label, onRun }) {
  const ref = useRef(null);

  function keyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.target;
      const { selectionStart: a, selectionEnd: b } = el;
      const next = value.slice(0, a) + '  ' + value.slice(b);
      onChange(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
      return;
    }
    // Ctrl/⌘+Enter runs, the convention every notebook and query
    // console already uses.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onRun) {
      e.preventDefault();
      onRun();
    }
  }

  return (
    <textarea
      ref={ref}
      className="upg-editor"
      value={value}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      rows={rows}
      aria-label={label}
      onChange={e => onChange(e.target.value)}
      onKeyDown={keyDown}
    />
  );
}

/* ══ JavaScript ═══════════════════════════════════════════════════════ */

/**
 * Run a puzzle's tests.
 *
 * Hidden cases are shown as pass/fail only until they pass, at which
 * point there is nothing left to protect and the inputs are revealed.
 * Hiding them forever would make a failure unfixable; showing them up
 * front makes them special-caseable. Revealing on success is the only
 * version that is neither.
 */
export function JsRunner({ puzzle, onSolved }) {
  const [source, setSource] = useState(puzzle.starter);
  const [state, setState] = useState(null);       // run result | null
  const [busy, setBusy] = useState(false);
  const [showSolution, setShowSolution] = useState(false);

  // A different puzzle is a different editor. Without this, opening the
  // next one silently keeps the previous answer.
  useEffect(() => {
    setSource(puzzle.starter);
    setState(null);
    setShowSolution(false);
  }, [puzzle.id]);

  const supported = canRun();

  async function run() {
    if (busy || !supported) return;
    setBusy(true);
    const res = await runJs({ source, fnName: puzzle.fnName, tests: puzzle.tests });
    setBusy(false);
    setState(res);
    if (res.ok && res.results.every(r => r.pass)) onSolved?.();
  }

  const passed = state?.ok ? state.results.filter(r => r.pass).length : 0;
  const total = puzzle.tests.length;
  const allPass = !!state?.ok && passed === total;

  return (
    <div className="upg-run">
      <div className="upg-run-bar">
        <span className="upg-run-sig">{puzzle.signature}</span>
        <button type="button" className="upg-run-btn" onClick={run} disabled={busy || !supported}>
          {busy ? 'Running…' : <><Icon name="play" size={12} /> Run</>}
        </button>
      </div>

      <CodeEditor value={source} onChange={setSource} onRun={run} rows={14}
                  label={`Your solution for ${puzzle.title}`} />

      {!supported && (
        <div className="upg-run-msg is-bad">
          This browser won&apos;t give us a Web Worker, so there is nowhere safe to run
          your code. Everything else on the page still works.
        </div>
      )}

      <div className="upg-run-hintbar">
        <span className="upg-fine">Tab indents · {navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl'}+Enter runs</span>
        <button type="button" className="upg-textbtn" onClick={() => setShowSolution(v => !v)}>
          {showSolution ? 'Hide the answer' : 'Show the answer'}
        </button>
      </div>

      {showSolution && (
        <div className="upg-field">
          <span className="upg-field-lbl">One way to do it</span>
          <pre className="upg-snip-body">{puzzle.solution}</pre>
        </div>
      )}

      {state && !state.ok && (
        <div className="upg-run-msg is-bad">
          <b>{state.phase === 'timeout' ? 'Too slow' : state.phase === 'compile' ? "Won't compile" : 'Failed'}</b>
          {' — '}{state.error}
        </div>
      )}

      {state?.ok && (
        <>
          <div className={'upg-run-score' + (allPass ? ' is-good' : '')}>
            {passed}/{total} passing
            {allPass && <span className="upg-run-tick">✓ solved</span>}
            <span className="upg-run-ms">{state.ms} ms</span>
          </div>
          <div className="upg-cases">
            {state.results.map((r, i) => (
              <div key={i} className={'upg-case' + (r.pass ? ' is-pass' : ' is-fail')}>
                <span className="upg-case-tick">{r.pass ? '✓' : '✗'}</span>
                <div className="upg-case-body">
                  {/* A hidden case that fails stays hidden — that is the
                      point of it — but it says so, rather than looking
                      like a bug in the test list. */}
                  {r.hidden && !allPass ? (
                    <div className="upg-case-args">hidden case {r.pass ? 'passed' : 'failed'}</div>
                  ) : (
                    <>
                      <div className="upg-case-args">{puzzle.fnName}({r.args})</div>
                      {!r.pass && (
                        <div className="upg-case-diff">
                          {r.threw
                            ? <>threw <b>{r.threw}</b></>
                            : <>expected <b>{r.expected}</b>, got <b>{r.got}</b></>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ══ KQL ══════════════════════════════════════════════════════════════ */

function ResultTable({ result, cap = 12 }) {
  if (!result) return null;
  if (!result.rows.length) {
    return <div className="upg-kql-empty">No rows.</div>;
  }
  const shown = result.rows.slice(0, cap);
  return (
    <div className="upg-kql-table-wrap">
      <table className="upg-kql-table">
        <thead>
          <tr>{result.columns.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {result.columns.map(c => <td key={c}>{fmtCell(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > cap && (
        <div className="upg-fine">…and {result.rows.length - cap} more rows.</div>
      )}
    </div>
  );
}

function fmtCell(v) {
  if (v == null) return '—';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Write a query, run it against the bundled tables, and be told whether
 * it agrees with the reference answer.
 *
 * `now` is frozen when the panel mounts. It has to be: the tables are
 * built relative to a clock, and letting it tick would mean your query
 * and the reference ran against subtly different data — a check that
 * fails for reasons nothing on screen can explain.
 */
export function KqlRunner({ problem, onSolved }) {
  const [nowRef] = useState(() => new Date());
  const [tables] = useState(() => buildTables(nowRef));
  const [query, setQuery] = useState(problem.tables?.[0] ? problem.tables[0] + '\n| ' : '');
  const [out, setOut] = useState(null);           // { result } | { error }
  const [verdict, setVerdict] = useState(null);
  const [expected, setExpected] = useState(null);
  const [showSchema, setShowSchema] = useState(false);
  const [showSolution, setShowSolution] = useState(false);

  useEffect(() => {
    setQuery(problem.tables?.[0] ? problem.tables[0] + '\n| ' : '');
    setOut(null); setVerdict(null); setExpected(null); setShowSolution(false);
  }, [problem.id]);

  // Can the runner handle this exercise at all? Answered by running the
  // reference solution, not by a hand-maintained flag that could drift
  // from what the engine actually supports.
  const [supported, why] = (() => {
    try { runKql(problem.solution, tables, nowRef); return [true, null]; }
    catch (e) { return [false, e instanceof KqlError ? e.message : String(e)]; }
  })();

  function run() {
    let mine;
    try {
      mine = runKql(query, tables, nowRef);
    } catch (e) {
      setOut({ error: e instanceof KqlError ? e.message : String(e) });
      setVerdict(null);
      return;
    }
    setOut({ result: mine });
    if (!supported) { setVerdict(null); return; }

    const want = runKql(problem.solution, tables, nowRef);
    setExpected(want);
    const v = compareResults(mine, want, queryIsOrdered(problem.solution));
    setVerdict(v);
    if (v.pass) onSolved?.();
  }

  const usedTables = problem.tables || [];

  return (
    <div className="upg-run">
      <div className="upg-run-bar">
        <span className="upg-run-sig">
          {usedTables.join(' · ')} · {new Date(nowRef).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} as &quot;now&quot;
        </span>
        <button type="button" className="upg-textbtn" onClick={() => setShowSchema(v => !v)}>
          {showSchema ? 'Hide schema' : 'Schema'}
        </button>
        <button type="button" className="upg-run-btn" onClick={run}>
          <Icon name="play" size={12} /> Run
        </button>
      </div>

      {showSchema && (
        <div className="upg-schema">
          {Object.entries(TABLE_SCHEMA)
            .filter(([name]) => !usedTables.length || usedTables.includes(name))
            .map(([name, cols]) => (
              <div key={name} className="upg-schema-tbl">
                <div className="upg-schema-h">{name}</div>
                {cols.map(([col, type]) => (
                  <div key={col} className="upg-schema-col">
                    <span className="upg-schema-name">{col}</span>
                    <span className="upg-schema-type">{type}</span>
                  </div>
                ))}
              </div>
            ))}
          <div className="upg-schema-tbl">
            <div className="upg-schema-h">ResultType</div>
            {RESULT_TYPES.map(([code, meaning]) => (
              <div key={code} className="upg-schema-col">
                <span className="upg-schema-name">{code}</span>
                <span className="upg-schema-type">{meaning}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <CodeEditor value={query} onChange={setQuery} onRun={run} rows={10}
                  label={`Your query for ${problem.title}`} />

      {!supported && (
        <div className="upg-run-msg">
          {/* Said plainly, with the reason. A runner that quietly marked
              this exercise "correct" would be worse than one that
              admits its limits. */}
          <b>Not checkable here.</b> The reference answer uses something this
          runner doesn&apos;t implement — {why} You can still write and run a query
          against the tables; it just won&apos;t be marked.
        </div>
      )}

      <div className="upg-run-hintbar">
        <span className="upg-fine">
          Tab indents · {navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl'}+Enter runs
          {supported && !queryIsOrdered(problem.solution) && ' · row order is not checked'}
        </span>
        <button type="button" className="upg-textbtn" onClick={() => setShowSolution(v => !v)}>
          {showSolution ? 'Hide the answer' : 'Show the answer'}
        </button>
      </div>

      {showSolution && <pre className="upg-snip-body">{problem.solution}</pre>}

      {out?.error && <div className="upg-run-msg is-bad">{out.error}</div>}

      {verdict && (
        <div className={'upg-run-score' + (verdict.pass ? ' is-good' : '')}>
          {verdict.pass ? 'Matches the reference answer' : verdict.why}
          {verdict.pass && <span className="upg-run-tick">✓ solved</span>}
        </div>
      )}

      {out?.result && (
        <div className="upg-field">
          <span className="upg-field-lbl">
            Your result — {out.result.rows.length} row{out.result.rows.length === 1 ? '' : 's'}
          </span>
          <ResultTable result={out.result} />
        </div>
      )}

      {/* The expected table only appears once you have run something and
          got it wrong. Showing it alongside from the start would make
          the exercise a copying task. */}
      {verdict && !verdict.pass && expected && (
        <details className="upg-expected">
          <summary>What the reference answer returns ({expected.rows.length} rows)</summary>
          <ResultTable result={expected} />
        </details>
      )}
    </div>
  );
}
