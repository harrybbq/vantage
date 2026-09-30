/**
 * The consent sheet, and the one place S.consent is written from outside
 * Settings.
 *
 * Two ways it opens:
 *   - once, for everyone (existing accounts included), after the cloud
 *     copy has loaded and the tutorial is done — both kinds, nothing
 *     pre-ticked, because explicit consent is an affirmative act;
 *   - just in time, when something calls requestConsent(kind) (see
 *     lib/consent/request.js) — one kind, Allow or Not now.
 *
 * Saying no is always a working answer. Features that need neither keep
 * working, data already recorded stays visible, and the next time a
 * feature needs consent it asks again at that moment.
 *
 * Data safety: the only write is `consent`, through consentPatch, which
 * spreads the previous object. It is never made before `hydrated` — an
 * answer given while the cloud copy is still loading is held and applied
 * once it lands, so it can't be written against the default seed.
 *
 * Mobile: the sheet is a .modal (height-capped, scrolls internally), so
 * the backdrop above it stays tappable; tapping it is "Not now".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Overlay from '../ui/Overlay';
import { KINDS, isGranted, consentPatch, shouldAskOnce } from '../../lib/consent/consent';
import { registerConsentHost, syncConsent } from '../../lib/consent/request';
import { CONSENT_COPY } from './consentCopy';

export default function ConsentHost({ S, update, hydrated, onOpenLegal }) {
  const consent = S?.consent;
  // Mirror into request.js during render as well as after it, so a
  // requestConsent() fired by the same click that just granted consent
  // (or by a component mounting in this render) sees the new value.
  syncConsent(consent);

  const [sheet, setSheet] = useState(null);        // null | { mode: 'once' | 'jit' }
  const [picked, setPicked] = useState({});        // once-mode ticks
  const [, bump] = useState(0);                    // re-render when waiters change
  const waiters = useRef([]);                      // [{ kind, resolve }]
  const onceDone = useRef(false);                  // answered this session
  const heldWrites = useRef([]);                   // answers given before hydration
  const consentRef = useRef(consent);
  consentRef.current = consent;
  const hydratedRef = useRef(hydrated);
  hydratedRef.current = hydrated;

  const write = useCallback((choices) => {
    const iso = new Date().toISOString();
    // Keep request.js ahead of the state round trip so a second call in
    // the same tick doesn't ask twice.
    const next = consentPatch(consentRef.current, choices, iso);
    syncConsent(next);
    consentRef.current = next;
    const apply = () => update(prev => ({ ...prev, consent: consentPatch(prev.consent, choices, iso) }));
    if (hydratedRef.current) apply();
    else heldWrites.current.push(apply);
  }, [update]);

  useEffect(() => {
    if (!hydrated || !heldWrites.current.length) return;
    const held = heldWrites.current;
    heldWrites.current = [];
    held.forEach(fn => fn());
  }, [hydrated]);

  // Just-in-time asks from anywhere in the app.
  useEffect(() => registerConsentHost(kind => new Promise(resolve => {
    if (isGranted(consentRef.current, kind)) { resolve(true); return; }
    waiters.current.push({ kind, resolve });
    setSheet(cur => cur || { mode: 'jit' });
    bump(x => x + 1);
  })), []);

  // The one-time ask.
  useEffect(() => {
    if (sheet || onceDone.current) return;
    if (!shouldAskOnce(S, hydrated)) return;
    setPicked({ health: isGranted(consent, 'health'), ai: isGranted(consent, 'ai') });
    setSheet({ mode: 'once' });
  }, [S, hydrated, sheet, consent]);

  function finish(choices) {
    write(choices);
    const pending = waiters.current;
    waiters.current = [];
    for (const w of pending) {
      w.resolve(choices[w.kind] === true || (!(w.kind in choices) && isGranted(consentRef.current, w.kind)));
    }
    if (sheet?.mode === 'once') onceDone.current = true;
    setSheet(null);
  }

  if (!sheet) return null;

  const once = sheet.mode === 'once';
  const kinds = once
    ? KINDS
    : KINDS.filter(k => waiters.current.some(w => w.kind === k));

  // "Not now" / backdrop: every kind on the sheet that isn't already
  // granted is recorded as declined. Nothing already granted is touched.
  function decline() {
    const choices = {};
    for (const k of kinds) if (!isGranted(consentRef.current, k)) choices[k] = false;
    finish(choices);
  }

  function allow() {
    const choices = {};
    for (const k of kinds) choices[k] = true;
    finish(choices);
  }

  function saveOnce() {
    finish({ health: !!picked.health, ai: !!picked.ai });
  }

  const title = once
    ? 'Your say on two kinds of data'
    : kinds.length === 1
      ? `Allow ${CONSENT_COPY[kinds[0]].title.toLowerCase()}?`
      : 'Allow these?';

  return (
    <Overlay>
      <div
        className="modal-overlay open consent-overlay"
        onClick={decline}
        role="presentation"
      >
        <div
          className="modal consent-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="consent-title"
          onClick={e => e.stopPropagation()}
        >
          <div className="consent-eyebrow">Consent · UK GDPR</div>
          <h3 className="consent-title" id="consent-title">{title}</h3>
          <p className="consent-sub">
            {once
              ? 'Vantage works without either. Tick what you want to use — you can change this any time in Settings → Privacy.'
              : 'You can change this any time in Settings → Privacy.'}
          </p>

          <div className="consent-list">
            {kinds.map(k => {
              const c = CONSENT_COPY[k];
              const body = (
                <div className="consent-item-body">
                  <div className="consent-item-title">{c.title}</div>
                  <p className="consent-item-text">{c.what}</p>
                  <p className="consent-item-text consent-item-where">{c.where}</p>
                </div>
              );
              return once ? (
                <label key={k} className={`consent-item${picked[k] ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!!picked[k]}
                    onChange={() => setPicked(p => ({ ...p, [k]: !p[k] }))}
                  />
                  {body}
                </label>
              ) : (
                <div key={k} className="consent-item is-static">{body}</div>
              );
            })}
          </div>

          {onOpenLegal && (
            <p className="consent-legal">
              More in the{' '}
              <button type="button" onClick={() => onOpenLegal('privacy')}>Privacy Policy</button>.
            </p>
          )}

          <div className="consent-actions">
            {once ? (
              <button type="button" className="btn btn-primary" onClick={saveOnce}>
                {picked.health || picked.ai ? 'Save my choices' : 'Continue without'}
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={decline}>Not now</button>
                <button type="button" className="btn btn-primary" onClick={allow}>Allow</button>
              </>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}
