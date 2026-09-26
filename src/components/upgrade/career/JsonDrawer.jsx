/**
 * "Edit data" — the plan's content as JSON, validated before it is saved.
 *
 * This is what makes the Career plan editable without a code change: add
 * a timeline item, a company, a scenario, and it renders. A save that
 * fails validation (lib/career/schema) never leaves the browser, and a
 * save that does reach Supabase archives the previous version first
 * (owner_content_history), so a bad edit is recoverable.
 */
import { useMemo, useState } from 'react';
import { Sheet } from '../UpgSheet';
import { validate } from '../../../lib/career/schema';

export default function JsonDrawer({ title, contentKey, value, onSave, onClose }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const parsed = useMemo(() => {
    try { return { ok: true, data: JSON.parse(text) }; } catch (e) { return { ok: false, err: e.message }; }
  }, [text]);
  const errors = parsed.ok ? validate(contentKey, parsed.data) : [`JSON: ${parsed.err}`];

  async function save() {
    if (errors.length || busy) return;
    setBusy(true);
    const r = await onSave(parsed.data);
    setBusy(false);
    if (r && r.ok === false) setSaveErr(r.message || 'Save failed.');
    else onClose();
  }

  return (
    <Sheet title={title} onClose={onClose} onSave={errors.length ? null : save} saveLabel={busy ? 'Saving…' : 'Save'} wide>
      <div className="upg-fine">
        Stored under <code>{contentKey}</code>, owner-only. Checked before saving; the previous version is kept in history.
      </div>
      <textarea className="upg-code cp-json" rows={22} spellCheck={false} value={text}
                onChange={e => { setText(e.target.value); setSaveErr(''); }} aria-label={`${title} JSON`} />
      {errors.length > 0 && (
        <ul className="cp-json-errs" role="alert">
          {errors.map(e => <li key={e}>{e}</li>)}
        </ul>
      )}
      {saveErr && <div className="cp-json-errs" role="alert">{saveErr}</div>}
    </Sheet>
  );
}
