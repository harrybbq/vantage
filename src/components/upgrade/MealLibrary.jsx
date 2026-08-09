/**
 * Meal library — recipes and saved videos, in the Diet tab.
 *
 * Two lists rather than one, which was a deliberate call: a video has no
 * macros and a recipe has no watch state, so a merged list would leave
 * half its columns empty whichever row you were looking at. The link
 * between them is one action — "Make this a recipe" pre-fills a new
 * recipe from a video.
 *
 * Photos live in Supabase Storage (lib/diet/recipeImages.js) and fail
 * soft until the bucket exists. Everything else is in S.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { supabase } from '../../lib/supabase';
import {
  EMPTY_RECIPE, MEAL_TYPES, PLATFORM_LABEL, RECIPE_TAGS, VIDEO_TAGS,
  batchTotals, filterItems, isPortrait, parseVideoUrl, servingToLogRow,
  shareOfTarget, tagCounts, videoThumb,
} from '../../lib/diet/meals';
import { deleteRecipeImage, signedUrls, uploadRecipeImage } from '../../lib/diet/recipeImages';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);

/* ══ Recipes ══════════════════════════════════════════════════════════ */

export function RecipesPanel({ S, update, userId, targets }) {
  const recipes = useMemo(() => S.recipes || [], [S.recipes]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [openId, setOpenId] = useState(null);
  const [urls, setUrls] = useState({});
  const [setupMsg, setSetupMsg] = useState('');

  // One signed-URL request for the whole grid, not one per card.
  useEffect(() => {
    let alive = true;
    const paths = recipes.map(r => r.image).filter(Boolean);
    if (!paths.length) { setUrls({}); return undefined; }
    signedUrls(paths).then(({ urls: u, error }) => {
      if (!alive) return;
      if (error) setSetupMsg(error.message); else { setUrls(u); setSetupMsg(''); }
    });
    return () => { alive = false; };
  }, [recipes]);

  const save = next => update(prev => ({ ...prev, recipes: next }));
  const upsert = r => save(recipes.some(x => x.id === r.id) ? recipes.map(x => (x.id === r.id ? r : x)) : [...recipes, r]);
  const remove = async r => {
    if (r.image) await deleteRecipeImage(r.image);
    save(recipes.filter(x => x.id !== r.id));
  };

  const rows = filterItems(recipes, { q, tag });
  const open = recipes.find(r => r.id === openId) || null;

  return (
    <>
      <div className="upg-toolbar">
        <input className="upg-search" value={q} onChange={e => setQ(e.target.value)}
               placeholder="Search recipes — name, ingredient or tag" />
        <button type="button" className="link-open-btn"
                onClick={() => { const r = { ...EMPTY_RECIPE(), id: uid(), createdAt: Date.now() }; upsert(r); setOpenId(r.id); }}>
          + Recipe
        </button>
      </div>

      <div className="upg-chipset">
        <button type="button" className={'upg-opt' + (tag === '' ? ' is-on' : '')} onClick={() => setTag('')}>
          All · {recipes.length}
        </button>
        {tagCounts(recipes).map(([t, n]) => (
          <button key={t} type="button" className={'upg-opt' + (tag === t ? ' is-on' : '')}
                  onClick={() => setTag(tag === t ? '' : t)}>{t} · {n}</button>
        ))}
      </div>

      {setupMsg && <div className="upg-setup"><Icon name="triangle-alert" size={13} /> {setupMsg}</div>}
      {!rows.length && (
        <div className="upg-empty">
          {recipes.length ? 'Nothing matches that.' : 'No recipes yet. Add the one you cook most.'}
        </div>
      )}

      <div className="upg-rgrid">
        {rows.map(r => {
          const share = shareOfTarget(r, targets);
          return (
            <button key={r.id} type="button" className="upg-rcard" onClick={() => setOpenId(r.id)}>
              <span className="upg-rshot">
                {r.image && urls[r.image]
                  ? <img src={urls[r.image]} alt="" loading="lazy" />
                  : <span className="upg-rshot-none"><Icon name="image" size={18} /></span>}
                {(r.tags || [])[0] && <span className="upg-rbadge">{r.tags[0]}</span>}
              </span>
              <span className="upg-rbody">
                <span className="upg-rtitle">{r.title || 'Untitled recipe'}</span>
                <span className="upg-macros">
                  <span className="upg-macro is-kcal">{r.kcal || 0} kcal</span>
                  <span className="upg-macro">P {r.protein || 0}</span>
                  <span className="upg-macro">C {r.carbs || 0}</span>
                  <span className="upg-macro">F {r.fat || 0}</span>
                </span>
                <span className="upg-rfoot">
                  {r.minutes ? <span>{r.minutes} min</span> : null}
                  <span>×{r.servings || 1}</span>
                  {share && <span className="upg-rshare">{share.kcal}% of today</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {open && (
        <RecipeSheet recipe={open} userId={userId} targets={targets}
                     imageUrl={open.image ? urls[open.image] : null}
                     onClose={() => setOpenId(null)}
                     onChange={patch => upsert({ ...open, ...patch })}
                     onDelete={() => { remove(open); setOpenId(null); }} />
      )}
    </>
  );
}

function RecipeSheet({ recipe, userId, targets, imageUrl, onClose, onChange, onDelete }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);
  const share = shareOfTarget(recipe, targets);
  const batch = batchTotals(recipe);

  async function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg('');
    const old = recipe.image;
    const { path, error } = await uploadRecipeImage(userId, recipe.id, file);
    if (error) setMsg(error.message);
    else {
      onChange({ image: path });
      if (old) deleteRecipeImage(old);       // replaced, so the old one is dead weight
      setMsg('');
    }
    setBusy(false);
  }

  const num = (k, v) => onChange({ [k]: Math.max(0, parseFloat(v) || 0) });

  return (
    <div className="modal-overlay open" onClick={onClose} role="presentation">
      <div className="modal upg-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="upg-day-head">
          <input className="upg-title-input" value={recipe.title} placeholder="Recipe name"
                 onChange={e => onChange({ title: e.target.value })} />
          <button type="button" className="link-del-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="upg-sheet-body">
          <button type="button" className="upg-rshot is-editable" onClick={() => fileRef.current?.click()}>
            {imageUrl
              ? <img src={imageUrl} alt="" />
              : <span className="upg-rshot-none"><Icon name="image" size={22} />
                  <span>{busy ? 'Uploading…' : 'Add a photo'}</span></span>}
          </button>
          <input ref={fileRef} type="file" hidden accept="image/*" onChange={pickImage} />
          {msg && <div className="upg-fine" style={{ marginBottom: 10 }}>{msg}</div>}

          <div className="upg-field">
            <span className="upg-field-lbl">Per serving · makes {recipe.servings || 1}</span>
            <div className="upg-macro-row">
              {[['kcal', 'kcal'], ['protein', 'protein g'], ['carbs', 'carbs g'], ['fat', 'fat g']].map(([k, label]) => (
                <label key={k} className={'upg-macro-cell' + (k === 'kcal' ? ' kcal' : '')}>
                  <input className="upg-macro-input" type="number" min="0" value={recipe[k] || 0}
                         onChange={e => num(k, e.target.value)} />
                  <span className="k">{label}</span>
                </label>
              ))}
            </div>
            {share && (
              <div className="upg-srcbar" style={{ marginTop: 8 }}>
                <span>Against today’s target</span>
                <span className="upg-fit">{share.kcal}% of kcal · {share.protein}% of protein</span>
              </div>
            )}
            <div className="upg-fine" style={{ marginTop: 6 }}>
              Whole batch: {batch.kcal} kcal · {batch.protein}p · {batch.carbs}c · {batch.fat}f
            </div>
          </div>

          <div className="upg-two">
            <label className="upg-num"><span>Servings</span>
              <input type="number" min="1" value={recipe.servings || 1}
                     onChange={e => onChange({ servings: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></label>
            <label className="upg-num"><span>Minutes</span>
              <input type="number" min="0" value={recipe.minutes || 0}
                     onChange={e => num('minutes', e.target.value)} /></label>
          </div>

          <div className="upg-field">
            <span className="upg-field-lbl">Tags</span>
            <div className="upg-chipset">
              {[...new Set([...RECIPE_TAGS, ...(recipe.tags || [])])].map(t => {
                const on = (recipe.tags || []).includes(t);
                return (
                  <button key={t} type="button" className={'upg-opt' + (on ? ' is-on' : '')}
                          onClick={() => onChange({
                            tags: on ? recipe.tags.filter(x => x !== t) : [...(recipe.tags || []), t],
                          })}>{t}</button>
                );
              })}
            </div>
          </div>

          <label className="upg-field">
            <span className="upg-field-lbl">Ingredients — one per line</span>
            <textarea rows={6} value={(recipe.ingredients || []).join('\n')}
                      placeholder={'600g chicken thigh, diced\n300g basmati rice'}
                      onChange={e => onChange({ ingredients: e.target.value.split('\n') })} />
          </label>

          <label className="upg-field">
            <span className="upg-field-lbl">Method</span>
            <textarea rows={5} value={recipe.method || ''}
                      onChange={e => onChange({ method: e.target.value })} />
          </label>

          <label className="upg-field">
            <span className="upg-field-lbl">Saved from</span>
            <input value={recipe.sourceUrl || ''} placeholder="Optional link"
                   onChange={e => onChange({ sourceUrl: e.target.value })} />
          </label>

          <LogServing recipe={recipe} userId={userId} />
        </div>

        <div className="upg-day-actions">
          <button type="button" className="upg-textbtn" onClick={onDelete}>Delete recipe</button>
          <button type="button" className="link-open-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Log a serving into the real food log.
 *
 * Writes a nutrition_log row directly, the same table and shape
 * FoodLogSheet uses — so it lands in Track, counts toward the daily
 * summary, and feeds the Body Goal projection through actual intake.
 * A recipe whose macros only decorate a card would be pointless.
 */
function LogServing({ recipe, userId }) {
  const [meal, setMeal] = useState('dinner');
  const [servings, setServings] = useState(1);
  const [state, setState] = useState('idle');   // idle | saving | done | error
  const [msg, setMsg] = useState('');

  async function log() {
    if (!userId) return;
    setState('saving'); setMsg('');
    const row = servingToLogRow(recipe, { userId, logDate: today(), mealType: meal, servings });
    const { error } = await supabase.from('nutrition_log').insert(row);
    if (error) { setState('error'); setMsg(error.message || 'Couldn’t log that.'); return; }
    setState('done');
    setTimeout(() => setState('idle'), 2200);
  }

  return (
    <div className="upg-field upg-logbar">
      <span className="upg-field-lbl">Log a serving</span>
      <div className="upg-chipset">
        {MEAL_TYPES.map(m => (
          <button key={m} type="button" className={'upg-opt' + (meal === m ? ' is-on' : '')}
                  onClick={() => setMeal(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
        ))}
      </div>
      <div className="upg-logrow">
        <label className="upg-num" style={{ flex: '0 0 110px' }}>
          <span>Servings</span>
          <input type="number" min="0.25" step="0.25" value={servings}
                 onChange={e => setServings(Math.max(0.25, parseFloat(e.target.value) || 1))} />
        </label>
        <button type="button" className="link-open-btn" disabled={state === 'saving'} onClick={log}>
          {state === 'saving' ? 'Logging…' : state === 'done' ? 'Logged ✓' : `Log to today’s ${meal}`}
        </button>
      </div>
      {state === 'error' && <div className="upg-fine" style={{ color: '#e0796a' }}>{msg}</div>}
    </div>
  );
}

/* ══ Videos ═══════════════════════════════════════════════════════════ */

export function VideosPanel({ S, update }) {
  const videos = useMemo(() => S.mealVideos || [], [S.mealVideos]);
  const [paste, setPaste] = useState('');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState('');

  const save = next => update(prev => ({ ...prev, mealVideos: next }));

  function add() {
    const parsed = parseVideoUrl(paste);
    if (!parsed.valid) { setErr('That doesn’t look like a link.'); return; }
    const v = {
      id: uid(), url: parsed.url, platform: parsed.platform, videoId: parsed.videoId,
      title: '', note: '', tags: ['To try'], watched: false, savedAt: today(),
    };
    save([v, ...videos]);
    setPaste(''); setErr(''); setOpenId(v.id);
  }

  const rows = filterItems(videos, { q, tag });
  const open = videos.find(v => v.id === openId) || null;

  return (
    <>
      <div className="upg-toolbar">
        <input className="upg-search" value={paste} onChange={e => { setPaste(e.target.value); setErr(''); }}
               onKeyDown={e => { if (e.key === 'Enter') add(); }}
               placeholder="Paste a YouTube or TikTok link…" />
        <button type="button" className="link-open-btn" onClick={add}>+ Save</button>
      </div>
      {err && <div className="upg-fine" style={{ color: '#e0796a' }}>{err}</div>}

      <input className="upg-search" value={q} onChange={e => setQ(e.target.value)}
             placeholder="Search saved videos" />

      <div className="upg-chipset">
        <button type="button" className={'upg-opt' + (tag === '' ? ' is-on' : '')} onClick={() => setTag('')}>
          All · {videos.length}
        </button>
        {tagCounts(videos).map(([t, n]) => (
          <button key={t} type="button" className={'upg-opt' + (tag === t ? ' is-on' : '')}
                  onClick={() => setTag(tag === t ? '' : t)}>{t} · {n}</button>
        ))}
      </div>

      {!rows.length && (
        <div className="upg-empty">
          {videos.length ? 'Nothing matches that.' : 'Nothing saved. Paste a link above.'}
        </div>
      )}

      <div className="upg-vgrid">
        {rows.map(v => {
          const thumb = videoThumb(v);
          return (
            <button key={v.id} type="button" className="upg-vrow" onClick={() => setOpenId(v.id)}>
              <span className={'upg-vthumb' + (isPortrait(v.platform) ? ' is-tall' : '')}>
                {thumb
                  ? <img src={thumb} alt="" loading="lazy" />
                  : <span className={`upg-vtile is-${v.platform}`}>{(PLATFORM_LABEL[v.platform] || '?')[0]}</span>}
              </span>
              <span className="upg-vmeta">
                <span className="upg-vtitle">{v.title || v.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</span>
                <span className="upg-vsub">
                  <span className={`upg-plat is-${v.platform}`}>{PLATFORM_LABEL[v.platform] || 'Link'}</span>
                  {v.watched && <span>Made it</span>}
                  <span>{v.savedAt}</span>
                </span>
                {v.note && <span className="upg-vnote">{v.note}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {open && (
        <VideoSheet video={open}
                    onClose={() => setOpenId(null)}
                    onChange={patch => save(videos.map(v => (v.id === open.id ? { ...v, ...patch } : v)))}
                    onDelete={() => { save(videos.filter(v => v.id !== open.id)); setOpenId(null); }}
                    onMakeRecipe={() => {
                      update(prev => ({
                        ...prev,
                        recipes: [...(prev.recipes || []), {
                          ...EMPTY_RECIPE(), id: uid(), createdAt: Date.now(),
                          title: open.title || '', sourceUrl: open.url,
                          tags: (open.tags || []).filter(t => t !== 'To try'),
                        }],
                      }));
                      setOpenId(null);
                    }} />
      )}
    </>
  );
}

function VideoSheet({ video, onClose, onChange, onDelete, onMakeRecipe }) {
  const thumb = videoThumb(video);
  return (
    <div className="modal-overlay open" onClick={onClose} role="presentation">
      <div className="modal upg-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="upg-day-head">
          <input className="upg-title-input" value={video.title} placeholder="What is it?"
                 onChange={e => onChange({ title: e.target.value })} />
          <button type="button" className="link-del-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="upg-sheet-body">
          {thumb && (
            <span className={'upg-vthumb is-hero' + (isPortrait(video.platform) ? ' is-tall' : '')}>
              <img src={thumb} alt="" />
            </span>
          )}
          <a className="link-open-btn" href={video.url} target="_blank" rel="noreferrer noopener"
             style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', marginBottom: 12 }}>
            Open on {PLATFORM_LABEL[video.platform] || 'the web'} <Icon name="external-link" size={12} />
          </a>

          <div className="upg-field">
            <span className="upg-field-lbl">Tags</span>
            <div className="upg-chipset">
              {[...new Set([...VIDEO_TAGS, ...(video.tags || [])])].map(t => {
                const on = (video.tags || []).includes(t);
                return (
                  <button key={t} type="button" className={'upg-opt' + (on ? ' is-on' : '')}
                          onClick={() => onChange({
                            tags: on ? video.tags.filter(x => x !== t) : [...(video.tags || []), t],
                            ...(t === 'Made it' && !on ? { watched: true } : {}),
                          })}>{t}</button>
                );
              })}
            </div>
          </div>

          <label className="upg-field">
            <span className="upg-field-lbl">Note</span>
            <textarea rows={4} value={video.note || ''}
                      placeholder="The bit worth coming back for — and what you'd change."
                      onChange={e => onChange({ note: e.target.value })} />
          </label>
        </div>

        <div className="upg-day-actions">
          <button type="button" className="upg-textbtn" onClick={onDelete}>Delete</button>
          <button type="button" className="upg-textbtn" onClick={onMakeRecipe}>Make this a recipe</button>
          <button type="button" className="link-open-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
