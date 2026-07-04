/**
 * SelfCheck — F5 Sprint 5 (generalised from BrainCheck, Sprint 4).
 *
 * Generic 16-question self-check engine shared by all four ranked
 * categories (Brain / Finance / Fitness / Social). Each category
 * exports a thin wrapper that hands this component its question
 * bank, label, and state-key.
 *
 * Mechanics (identical to the original BrainCheck so a Brain result
 * from before the refactor keeps its meaning):
 *   - 16 multiple-choice questions, 4 options each
 *   - 12-minute overall timer; auto-submits at 0
 *   - One pass through, no go-back — short and resistant to UI gaming
 *   - Result = round(70 + (correct / 16) × 60)
 *     (0 right → 70, 8 → 100, 16 → 130)
 *   - Saved to S[stateKey] = { result, ts, testVersion }
 *   - Re-takeable every 30 days via the exported cooldown helpers
 *
 * NOTE on Fitness / Social: these aren't "knowledge tests" in a
 * clinical sense — they're knowledge of the domain (exercise science,
 * communication / relationships). User-facing copy stays modest
 * ("self-check", not "test of your X") for the same reason BrainCheck
 * avoids calling itself an IQ test.
 */

import { useEffect, useState } from 'react';
import { backdropClose } from '../utils/backdropClose';

const TIME_LIMIT_MS = 12 * 60 * 1000;
const COOLDOWN_DAYS = 30;
const TOTAL_QUESTIONS = 16;

export { COOLDOWN_DAYS };

/**
 * True when the user's last result is younger than COOLDOWN_DAYS.
 * Pass any score-shaped object: { result, ts, testVersion }.
 */
export function isCooldownActive(score) {
  if (!score?.ts) return false;
  const ageMs = Date.now() - new Date(score.ts).getTime();
  return ageMs < COOLDOWN_DAYS * 86_400_000;
}

export function daysUntilRetake(score) {
  if (!score?.ts) return 0;
  const ageMs = Date.now() - new Date(score.ts).getTime();
  const remaining = COOLDOWN_DAYS * 86_400_000 - ageMs;
  return Math.max(0, Math.ceil(remaining / 86_400_000));
}

/**
 * Pure scoring fn — exposed for tests / future analytics. Expects an
 * array of selected indices (or null for skipped/timeout) and the
 * same questions array used by the test.
 */
export function scoreFromAnswers(answers, questions) {
  let correct = 0;
  for (let i = 0; i < questions.length; i++) {
    if (answers[i] === questions[i].answer) correct++;
  }
  const result = Math.round(70 + (correct / questions.length) * 60);
  return { correct, total: questions.length, result };
}

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Props:
 *   S, update, onClose       — state-hook trio
 *   stateKey                 — e.g. 'brainScore' / 'financeScore'
 *   testVersion              — bump when the bank gets re-balanced
 *   questions                — array of { q, choices:[4], answer:idx }
 *   eyebrow                  — mono uppercase label (e.g. 'BRAIN CHECK')
 *   completeEyebrow          — eyebrow shown on the result screen
 *   feedsLabel               — line under the big number on the result
 *                              screen (e.g. 'feeds your Brain rating')
 *   resultBlurb              — paragraph under feedsLabel
 */
export default function SelfCheck({
  S,
  update,
  onClose,
  stateKey,
  testVersion,
  questions,
  eyebrow,
  completeEyebrow,
  feedsLabel,
  resultBlurb,
}) {
  if (!Array.isArray(questions) || questions.length !== TOTAL_QUESTIONS) {
    // Guardrail — the 70-130 score range assumes exactly 16 questions.
    throw new Error(`SelfCheck expects exactly ${TOTAL_QUESTIONS} questions, got ${questions?.length}`);
  }

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState(() => Array(questions.length).fill(null));
  const [done, setDone] = useState(false);
  const [startMs] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      const el = Date.now() - startMs;
      setElapsedMs(el);
      if (el >= TIME_LIMIT_MS) {
        clearInterval(id);
        finishTest(answers);
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, answers]);

  function pick(choiceIdx) {
    const next = [...answers];
    next[idx] = choiceIdx;
    setAnswers(next);
    if (idx < questions.length - 1) {
      setIdx(idx + 1);
    } else {
      finishTest(next);
    }
  }

  function finishTest(finalAnswers) {
    const { result } = scoreFromAnswers(finalAnswers, questions);
    update(prev => ({
      ...prev,
      [stateKey]: {
        result,
        ts: new Date().toISOString(),
        testVersion,
      },
    }));
    setDone(true);
  }

  const remainingMs = Math.max(0, TIME_LIMIT_MS - elapsedMs);
  const mm = Math.floor(remainingMs / 60_000);
  const ss = Math.floor((remainingMs % 60_000) / 1000);
  const progressPct = ((idx + (done ? 1 : 0)) / questions.length) * 100;

  if (done) {
    const { correct, total, result } = scoreFromAnswers(answers, questions);
    return (
      <div className="modal-overlay open" {...backdropClose(() => onClose())}>
        <div className="modal" style={{ maxWidth: 460 }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.6,
            textTransform: 'uppercase', color: 'var(--em)', fontWeight: 700,
            marginBottom: 4,
          }}>// {completeEyebrow}</div>
          <h2 style={{
            fontFamily: 'var(--serif, Georgia, serif)', fontStyle: 'italic',
            fontWeight: 600, fontSize: 56, margin: '8px 0 4px',
            color: 'var(--text)', letterSpacing: -1,
          }}>{result}</h2>
          <p style={{
            fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: 0.6,
            color: 'var(--text-muted)', margin: '0 0 16px',
          }}>
            {correct}/{total} correct · {feedsLabel}
          </p>
          <p style={{
            fontFamily: 'var(--sans)', fontSize: 13, lineHeight: 1.6,
            color: 'var(--text)', margin: '0 0 14px',
          }}>
            {resultBlurb} Re-takeable every {COOLDOWN_DAYS} days.
            Your overall rating updates on the next refresh.
          </p>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={onClose}>Got it</button>
          </div>
        </div>
      </div>
    );
  }

  const Q = questions[idx];
  return (
    <div className="modal-overlay open" onClick={() => { /* don't dismiss mid-test */ }}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.6,
          textTransform: 'uppercase', color: 'var(--text-muted)',
          marginBottom: 4,
        }}>
          <span style={{ color: 'var(--em)', fontWeight: 700 }}>
            // {eyebrow} · {String(idx + 1).padStart(2, '0')} / {questions.length}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            ⏱ {pad2(mm)}:{pad2(ss)}
          </span>
        </div>
        <div style={{
          height: 4, background: 'var(--border)', borderRadius: 2,
          overflow: 'hidden', marginBottom: 18,
        }}>
          <div style={{
            width: `${progressPct}%`, height: '100%',
            background: 'var(--em)', transition: 'width .3s ease',
          }} />
        </div>

        <h3 style={{
          fontFamily: 'var(--serif, Georgia, serif)', fontStyle: 'italic',
          fontWeight: 600, fontSize: 18, lineHeight: 1.4,
          color: 'var(--text)', margin: '0 0 18px',
        }}>{Q.q}</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Q.choices.map((choice, i) => (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              style={{
                padding: '12px 14px', borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--card, rgba(255,255,255,0.04))',
                color: 'var(--text)',
                fontFamily: 'var(--sans)', fontSize: 13.5, fontWeight: 500,
                textAlign: 'left', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 12,
                transition: 'all .12s',
              }}
              className="brain-check-choice"
            >
              <span style={{
                width: 24, height: 24, borderRadius: '50%',
                background: 'var(--bg-base)', border: '1px solid var(--border)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
                color: 'var(--text-muted)', flexShrink: 0,
              }}>{String.fromCharCode(65 + i)}</span>
              <span style={{ flex: 1 }}>{choice}</span>
            </button>
          ))}
        </div>

        <p style={{
          fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 0.6,
          color: 'var(--text-muted)', marginTop: 14, marginBottom: 0,
          textAlign: 'center',
        }}>
          One pass · no go-back · auto-submits at 0:00
        </p>
      </div>
    </div>
  );
}
