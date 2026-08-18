/**
 * The CV document — shape, normalisation, and the tailored variants.
 *
 * ── What is stored, and why it is shaped this way ────────────────────
 *
 *   S.cv          the MAIN CV. Exactly the key it has always been, with
 *                 exactly the fields it has always had. Untouched.
 *   S.cvVariants  [{ id, name, createdAt, cv }] — copies tailored for a
 *                 specific job. New key.
 *   S.cvActive    the id of the variant being edited, or null for main.
 *                 New key.
 *
 * The obvious design was to move every CV into one `S.cvDocs` map and
 * point `S.cv` at it. That is a migration, and migrations against a
 * million-key synced blob are how data goes missing — so the main CV
 * stays exactly where it is and the new feature arrives entirely in new
 * keys. An account that never makes a variant has state identical to
 * before, and `cvActive` pointing at a variant that no longer exists
 * falls back to main rather than showing an empty document.
 *
 * ── Normalisation on READ, not on write ──────────────────────────────
 * Education used to be a list of strings; the editor now wants a row per
 * entry with its own id. Rather than rewriting anyone's stored data,
 * `normaliseCv` coerces on the way out. Old state keeps working, new
 * state is written in the richer shape, and nothing has to be converted.
 *
 * Pure — no React, no DOM, no network.
 */

export const EMPTY_CV = {
  header: { name: '', title: '', location: '', email: '', phone: '', link: '' },
  summary: '',
  experience: [],
  skills: [],
  education: [],
};

let seq = 0;
export const uid = (p = 'x') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = v => (Array.isArray(v) ? v : []);

/**
 * Whatever is in state → the shape the editor expects.
 *
 * Every branch here exists because some older version of the data could
 * look that way. It is deliberately total: given null, given a string
 * where an array should be, given a role with no id, it returns
 * something the UI can render rather than throwing halfway down a page.
 */
export function normaliseCv(raw) {
  const cv = raw && typeof raw === 'object' ? raw : {};
  const h = cv.header && typeof cv.header === 'object' ? cv.header : {};
  return {
    header: {
      name: str(h.name), title: str(h.title), location: str(h.location),
      email: str(h.email), phone: str(h.phone), link: str(h.link),
    },
    summary: str(cv.summary),
    experience: arr(cv.experience).filter(Boolean).map(r => ({
      id: r.id || uid('r'),
      role: str(r.role),
      org: str(r.org),
      from: str(r.from),
      to: str(r.to),
      // Bullets were a newline-joined textarea. Empty lines were how you
      // got a blank one, so they are dropped rather than kept as empty
      // list items that would print as stray dots.
      bullets: arr(r.bullets).map(str).filter(b => b.trim() !== ''),
    })),
    // Skills were a comma-joined string in the input, but always an
    // array in state. Trim and drop blanks, because "a, b, " produced a
    // trailing empty one.
    skills: arr(cv.skills).map(str).map(s => s.trim()).filter(Boolean),
    education: arr(cv.education).filter(Boolean).map(e => (
      typeof e === 'string'
        ? { id: uid('e'), what: e.trim(), where: '', when: '' }
        : { id: e.id || uid('e'), what: str(e.what), where: str(e.where), when: str(e.when) }
    )).filter(e => e.what || e.where || e.when),
    updatedAt: cv.updatedAt || 0,
  };
}

/** The variant list, always an array of well-formed entries. */
export function variants(S) {
  return arr(S && S.cvVariants).filter(v => v && v.id).map(v => ({
    id: v.id,
    name: str(v.name) || 'Untitled',
    createdAt: v.createdAt || 0,
    cv: v.cv,
  }));
}

/** The id actually being edited — null (main) if the stored one is gone. */
export function activeId(S) {
  const id = S && S.cvActive;
  if (!id) return null;
  return variants(S).some(v => v.id === id) ? id : null;
}

/** The CV being edited, normalised. */
export function activeCv(S) {
  const id = activeId(S);
  if (!id) return normaliseCv(S && S.cv);
  return normaliseCv(variants(S).find(v => v.id === id).cv);
}

export function activeName(S) {
  const id = activeId(S);
  if (!id) return 'Main';
  return variants(S).find(v => v.id === id).name;
}

/* ── Writers. All state updaters: prev → next. ─────────────────────── */

/**
 * Patch whichever CV is active.
 *
 * One function for both cases so no caller has to remember which key it
 * is writing to — forgetting that is how an edit lands on the main CV
 * while a variant is open.
 */
export function patchActive(prev, patch) {
  const id = activeId(prev);
  const stamp = { ...patch, updatedAt: Date.now() };
  if (!id) {
    return { ...prev, cv: { ...EMPTY_CV, ...(prev.cv || {}), ...stamp } };
  }
  return {
    ...prev,
    cvVariants: variants(prev).map(v => (
      v.id === id ? { ...v, cv: { ...EMPTY_CV, ...(v.cv || {}), ...stamp } } : v
    )),
  };
}

/** Copy the active CV into a new variant and switch to it. */
export function addVariant(prev, name) {
  const id = uid('cv');
  const copy = activeCv(prev);
  return {
    ...prev,
    cvVariants: [...variants(prev), {
      id, name: str(name).trim() || 'New version', createdAt: Date.now(), cv: copy,
    }],
    cvActive: id,
  };
}

export function renameVariant(prev, id, name) {
  return {
    ...prev,
    cvVariants: variants(prev).map(v => (v.id === id ? { ...v, name: str(name).trim() || v.name } : v)),
  };
}

/** Delete a variant. Never deletes the main CV — there is no path to. */
export function removeVariant(prev, id) {
  const left = variants(prev).filter(v => v.id !== id);
  return {
    ...prev,
    cvVariants: left,
    cvActive: prev.cvActive === id ? null : prev.cvActive,
  };
}

export function selectCv(prev, id) {
  return { ...prev, cvActive: id || null };
}

/* ── Item helpers ─────────────────────────────────────────────────── */

/** Move an item by id, one step. Returns the SAME array if it can't. */
export function moved(list, id, dir) {
  const i = list.findIndex(x => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export const emptyRole = () => ({ id: uid('r'), role: '', org: '', from: '', to: '', bullets: [] });
export const emptyEdu = () => ({ id: uid('e'), what: '', where: '', when: '' });

/* ── The length meter ─────────────────────────────────────────────── */

/*
 * How full the page is.
 *
 * A real page count needs the rendered document, which the editor has
 * and this module deliberately does not — a pure function that measures
 * text can be tested, and a DOM measurement cannot. So this estimates
 * from characters at a fixed width and is honest about being an
 * estimate: the UI says "about", and the number it drives is a bar
 * rather than a page count.
 *
 * LINES_PER_PAGE is A4 at the document's type size, measured once from
 * the rendered mockup. CHARS_PER_LINE likewise. If the document's type
 * scale changes, these change with it.
 */
export const CHARS_PER_LINE = 92;
export const CHARS_PER_BULLET_LINE = 86;
export const LINES_PER_PAGE = 46;

const wrapped = (text, width) => Math.max(1, Math.ceil(str(text).length / width));

export function estimateLines(cv) {
  const c = normaliseCv(cv);
  let lines = 0;
  lines += 3;                                            // name, contact, rule
  if (c.summary) lines += 1 + wrapped(c.summary, CHARS_PER_LINE);
  if (c.experience.length) lines += 1;                   // section label
  for (const r of c.experience) {
    lines += 2;                                          // title row + org
    for (const b of r.bullets) lines += wrapped(b, CHARS_PER_BULLET_LINE);
    lines += 1;                                          // gap after the role
  }
  if (c.skills.length) {
    lines += 1 + wrapped(c.skills.join(' · '), CHARS_PER_LINE);
  }
  if (c.education.length) {
    lines += 1 + c.education.length;
  }
  return lines;
}

/**
 * @returns {{lines, pages, fill, overBy}} fill is 0–1 against ONE page.
 * `overBy` is how many lines past a whole number of pages, so the UI can
 * say "four lines over" — which is actionable, where "1.09 pages" is not.
 */
export function lengthOf(cv) {
  const lines = estimateLines(cv);
  const pages = Math.max(1, Math.ceil(lines / LINES_PER_PAGE));
  const intoPage = lines - (pages - 1) * LINES_PER_PAGE;
  return {
    lines,
    pages,
    fill: Math.min(1, lines / LINES_PER_PAGE),
    // Lines left on the current page, or how many spill onto the next.
    roomLeft: LINES_PER_PAGE - intoPage,
    overBy: pages > 1 ? intoPage : 0,
  };
}

/** Plain text, for copying out or for a future export. */
export function cvText(cv) {
  const c = normaliseCv(cv);
  const out = [];
  const h = c.header;
  if (h.name) out.push(h.name);
  const contact = [h.title, h.location, h.email, h.phone, h.link].filter(Boolean).join(' · ');
  if (contact) out.push(contact);
  if (c.summary) out.push('', 'SUMMARY', c.summary);
  if (c.experience.length) {
    out.push('', 'EXPERIENCE');
    for (const r of c.experience) {
      out.push(`${r.role}${r.org ? ` — ${r.org}` : ''}${r.from || r.to ? `  (${[r.from, r.to].filter(Boolean).join(' — ')})` : ''}`);
      for (const b of r.bullets) out.push(`  • ${b}`);
    }
  }
  if (c.skills.length) out.push('', 'SKILLS', c.skills.join(' · '));
  if (c.education.length) {
    out.push('', 'EDUCATION');
    for (const e of c.education) {
      out.push([e.what, e.where, e.when].filter(Boolean).join(' — '));
    }
  }
  return out.join('\n');
}

/**
 * Is there anything in it at all?
 * Drives the empty state — a blank document with click-to-edit hints is
 * a puzzle, not an invitation.
 */
export function isBlank(cv) {
  const c = normaliseCv(cv);
  return !c.summary && !c.experience.length && !c.skills.length
    && !c.education.length && !Object.values(c.header).some(Boolean);
}
