/**
 * Meal library — recipes, in the Diet tab. Saved cooking videos live ON
 * recipes now: a recipe links any number of them (`recipe.videoIds`),
 * shows them in its sheet, and can read the ingredients and a macro
 * estimate out of their description (lib/diet/videoRecipe.js).
 *
 * There is no separate Videos list any more. Pasting a link starts a
 * recipe from it; a saved video that no recipe uses yet is listed at the
 * foot of the page so none are lost (S.mealVideos is kept as it was).
 *
 * Photos live in Supabase Storage (lib/diet/recipeImages.js) and fail
 * soft until the bucket exists. Everything else is in S.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { supabase } from '../../lib/supabase';
import {
  EMPTY_RECIPE, MEAL_TYPES, PLATFORM_LABEL, RECIPE_TAGS,
  batchTotals, filterItems, isPortrait, parseVideoUrl, servingToLogRow,
  shareOfTarget, tagCounts, videoThumb, linkedVideos, linkedRecipes, linkVideo, unlinkVideo, applyRead,
} from '../../lib/diet/meals';
import { readVideoRecipe } from '../../lib/diet/videoRecipe';
import { parseLine } from '../../lib/diet/ingredients';
import { deleteRecipeImage, signedUrls, uploadRecipeImage } from '../../lib/diet/recipeImages';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);

/* ══ Recipes ══════════════════════════════════════════════════════════ */

export function RecipesPanel({ S, update, userId, targets }) {
  const recipes = useMemo(() => S.recipes || [], [S.recipes]);
  const videos = useMemo(() => S.mealVideos || [], [S.mealVideos]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [openId, setOpenId] = useState(null);
  const [urls, setUrls] = useState({});
  const [setupMsg, setSetupMsg] = useState('');
  const [link, setLink] = useState('');
  const [linkErr, setLinkErr] = useState('');
  const [autoRead, setAutoRead] = useState(null);   // video id to read when its new recipe opens

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
  const loose = videos.filter(v => !linkedRecipes(v, recipes).length);

  // A new recipe from a video (a saved one, or a pasted link saved now),
  // opened straight away with its ingredients being read in.
  function recipeFromVideo(v, isNew) {
    const r = {
      ...EMPTY_RECIPE(), id: uid(), createdAt: Date.now(),
      // A readable video names the dish when it is read; the video's own
      // title (often clickbait) is only the fallback if reading fails.
      title: READABLE.has(v.platform) ? '' : v.title || '', sourceUrl: v.url, videoIds: [v.id],
      tags: (v.tags || []).filter(t => t !== 'To try' && t !== 'Made it'),
    };
    update(prev => ({
      ...prev,
      ...(isNew ? { mealVideos: [v, ...(prev.mealVideos || [])] } : {}),
      recipes: [...(prev.recipes || []), r],
    }));
    setOpenId(r.id);
    setAutoRead(v.id);
  }
  function fromLink() {
    const parsed = parseVideoUrl(link);
    if (!parsed.valid) { setLinkErr('That doesn’t look like a link.'); return; }
    const existing = videos.find(v => v.url === parsed.url);
    const v = existing || {
      id: uid(), url: parsed.url, platform: parsed.platform, videoId: parsed.videoId,
      title: '', note: '', tags: [], watched: false, savedAt: today(),
    };
    recipeFromVideo(v, !existing);
    setLink(''); setLinkErr('');
  }

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
      <div className="upg-toolbar">
        <input className="upg-search" value={link} onChange={e => { setLink(e.target.value); setLinkErr(''); }}
               onKeyDown={e => { if (e.key === 'Enter' && link.trim()) fromLink(); }}
               placeholder="Paste a YouTube or TikTok link to start a recipe from it" aria-label="Video link" />
        <button type="button" className="link-open-btn" onClick={fromLink} disabled={!link.trim()}>From video</button>
      </div>
      {linkErr && <div className="upg-fine" style={{ color: '#e0796a' }}>{linkErr}</div>}

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
          const vids = linkedVideos(r, videos);
          return (
            <button key={r.id} type="button" className="upg-rcard" onClick={() => setOpenId(r.id)}>
              <span className="upg-rshot">
                {r.image && urls[r.image]
                  ? <img src={urls[r.image]} alt="" loading="lazy" />
                  : <span className="upg-rshot-none"><Icon name="image" size={18} /></span>}
                {(r.tags || [])[0] && <span className="upg-rbadge">{r.tags[0]}</span>}
                {vids.length > 0 && (
                  <span className="upg-rvid" title={`${vids.length} linked video${vids.length === 1 ? '' : 's'}`}>
                    <Icon name="play" size={10} />{vids.length > 1 ? vids.length : ''}
                  </span>
                )}
              </span>
              <span className="upg-rbody">
                <span className="upg-rtitle">{r.title || 'Untitled recipe'}</span>
                {(names => names.length > 0 && (
                  <span className="upg-ringr" title={(r.ingredients || []).filter(l => String(l).trim()).join('\n')}>
                    {names.slice(0, 3).join(' · ')}{names.length > 3 ? ` +${names.length - 3}` : ''}
                  </span>
                ))((r.ingredients || []).map(l => parseLine(l)).filter(Boolean).map(p => p.item.split(',')[0].trim()))}
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

      {loose.length > 0 && (
        <section className="upg-loose">
          <span className="upg-field-lbl">Saved videos not in a recipe · {loose.length}</span>
          <div className="upg-loose-list">
            {loose.map(v => {
              const thumb = videoThumb(v);
              return (
                <div key={v.id} className="upg-loose-row">
                  <a href={v.url} target="_blank" rel="noreferrer noopener" className="upg-rvideo-link" title={`Open on ${PLATFORM_LABEL[v.platform] || 'the web'}`}>
                    <span className={'upg-vthumb' + (isPortrait(v.platform) ? ' is-tall' : '')}>
                      {thumb
                        ? <img src={thumb} alt="" loading="lazy" />
                        : <span className={`upg-vtile is-${v.platform}`}>{(PLATFORM_LABEL[v.platform] || '?')[0]}</span>}
                    </span>
                    <span className="upg-rvideo-meta">
                      <span className="upg-vtitle">{v.title || v.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</span>
                      <span className={`upg-plat is-${v.platform}`}>{PLATFORM_LABEL[v.platform] || 'Link'}</span>
                    </span>
                  </a>
                  <button type="button" className="upg-textbtn" onClick={() => recipeFromVideo(v, false)}>Make a recipe</button>
                  <button type="button" className="link-del-btn" aria-label={`Delete ${v.title || 'video'}`}
                          onClick={() => update(prev => ({ ...prev, mealVideos: (prev.mealVideos || []).filter(x => x.id !== v.id) }))}>✕</button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {open && (
        <RecipeSheet recipe={open} userId={userId} targets={targets} videos={videos} update={update}
                     autoRead={autoRead}
                     imageUrl={open.image ? urls[open.image] : null}
                     onClose={() => { setOpenId(null); setAutoRead(null); }}
                     onChange={patch => upsert({ ...open, ...patch })}
                     onDelete={() => { remove(open); setOpenId(null); }} />
      )}
    </>
  );
}

function RecipeSheet({ recipe, userId, targets, videos, update, autoRead, imageUrl, onClose, onChange, onDelete }) {
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

  // Typing a macro makes it yours: it is no longer the video's estimate.
  const num = (k, v) => onChange({ [k]: Math.max(0, parseFloat(v) || 0), ...(['kcal', 'protein', 'carbs', 'fat'].includes(k) ? { macrosEstimated: false } : {}) });

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

          <RecipeVideos recipe={recipe} videos={videos} update={update} onChange={onChange} autoRead={autoRead} />

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
              {recipe.macrosEstimated && <> · <span className="upg-est">estimated from the video, edit to correct</span></>}
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
 * The videos a recipe links to: thumbnails that open the video, an ×
 * to unlink, and a picker that links a saved video or saves a pasted
 * link and links it.
 */
const READABLE = new Set(['youtube', 'tiktok']);

function RecipeVideos({ recipe, videos, update, onChange, autoRead }) {
  const [picking, setPicking] = useState(false);
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');
  const [reading, setReading] = useState({});
  const [readErr, setReadErr] = useState({});
  const linked = linkedVideos(recipe, videos);
  const others = videos.filter(v => !linked.some(l => l.id === v.id));

  // Read a video's recipe (once; it is kept on the video) and fill what
  // this recipe is missing.
  async function read(v) {
    if (!READABLE.has(v.platform)) return;
    setReading(r => ({ ...r, [v.id]: true }));
    setReadErr(e => ({ ...e, [v.id]: '' }));
    const { read: got, error } = await readVideoRecipe(v.url);
    setReading(r => ({ ...r, [v.id]: false }));
    if (error) {
      setReadErr(e => ({ ...e, [v.id]: error }));
      if (!String(recipe.title || '').trim() && v.title) onChange({ title: v.title });
      return;
    }
    update(prev => applyRead(prev, v.id, recipe.id, got));
  }

  // A recipe just made from a video reads it straight away.
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoRead || autoDone.current) return;
    const v = videos.find(x => x.id === autoRead);
    if (!v) return;
    autoDone.current = true;
    if (!v.read) read(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead, videos]);

  function addPasted() {
    const parsed = parseVideoUrl(paste);
    if (!parsed.valid) { setErr('That doesn’t look like a link.'); return; }
    const existing = videos.find(v => v.url === parsed.url);
    const v = existing || {
      id: uid(), url: parsed.url, platform: parsed.platform, videoId: parsed.videoId,
      title: recipe.title || '', note: '', tags: [], watched: false, savedAt: today(),
    };
    update(prev => {
      const withVideo = existing ? prev : { ...prev, mealVideos: [v, ...(prev.mealVideos || [])] };
      return linkVideo(withVideo, recipe.id, v.id);
    });
    setPaste(''); setErr(''); setPicking(false);
    if (!v.read) read(v);
  }

  return (
    <div className="upg-field">
      <span className="upg-field-lbl">Videos</span>
      {linked.length > 0 && (
        <div className="upg-rvids">
          {linked.map(v => {
            const thumb = videoThumb(v);
            return (
              <div key={v.id} className="upg-rvideo">
                <a href={v.url} target="_blank" rel="noreferrer noopener" className="upg-rvideo-link"
                   title={`Open on ${PLATFORM_LABEL[v.platform] || 'the web'}`}>
                  <span className={'upg-vthumb' + (isPortrait(v.platform) ? ' is-tall' : '')}>
                    {thumb
                      ? <img src={thumb} alt="" loading="lazy" />
                      : <span className={`upg-vtile is-${v.platform}`}>{(PLATFORM_LABEL[v.platform] || '?')[0]}</span>}
                    <span className="upg-rvideo-play" aria-hidden="true"><Icon name="play" size={12} /></span>
                  </span>
                  <span className="upg-rvideo-meta">
                    <span className="upg-vtitle">{v.title || v.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</span>
                    <span className={`upg-plat is-${v.platform}`}>{PLATFORM_LABEL[v.platform] || 'Link'}</span>
                  </span>
                </a>
                <button type="button" className="link-del-btn" aria-label={`Unlink ${v.title || 'video'}`}
                        onClick={() => update(prev => unlinkVideo(prev, recipe.id, v.id))}>✕</button>
                <VideoRead v={v} recipe={recipe} busy={!!reading[v.id]} error={readErr[v.id]}
                           onRead={() => read(v)} onChange={onChange} />
              </div>
            );
          })}
        </div>
      )}
      {!picking ? (
        <button type="button" className="upg-textbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setPicking(true)}>
          + Link a video
        </button>
      ) : (
        <div className="upg-rvid-pick">
          <div className="upg-toolbar">
            <input className="upg-search" value={paste} autoFocus
                   onChange={e => { setPaste(e.target.value); setErr(''); }}
                   onKeyDown={e => { if (e.key === 'Enter') addPasted(); }}
                   placeholder="Paste a YouTube or TikTok link…" />
            <button type="button" className="link-open-btn" onClick={addPasted} disabled={!paste.trim()}>Link</button>
          </div>
          {err && <div className="upg-fine" style={{ color: '#e0796a' }}>{err}</div>}
          {others.length > 0 && (
            <>
              <span className="upg-fine">Or pick one you’ve saved</span>
              <div className="upg-rvid-list">
                {others.map(v => (
                  <button key={v.id} type="button" className="upg-rvid-opt"
                          onClick={() => { update(prev => linkVideo(prev, recipe.id, v.id)); setPicking(false); if (!v.read) read(v); }}>
                    <span className={`upg-plat is-${v.platform}`}>{PLATFORM_LABEL[v.platform] || 'Link'}</span>
                    <span>{v.title || v.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" className="upg-textbtn" style={{ alignSelf: 'flex-start' }} onClick={() => { setPicking(false); setPaste(''); setErr(''); }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/**
 * The ingredients box under a linked video: what the video says goes in
 * it, where that came from, the macro estimate, and buttons to use them.
 */
function VideoRead({ v, recipe, busy, error, onRead, onChange }) {
  const r = v.read;
  const readable = READABLE.has(v.platform);
  if (!r && !busy && !error) {
    return readable ? (
      <button type="button" className="upg-textbtn upg-vread-get" onClick={onRead}>Get the ingredients from this video</button>
    ) : null;
  }
  if (busy) return <div className="upg-vread is-busy"><span className="upg-spin" aria-hidden="true" /> Reading the video…</div>;
  if (error && !r) {
    return <div className="upg-vread is-err">{error} <button type="button" className="upg-textbtn" onClick={onRead}>Try again</button></div>;
  }
  const same = (a, b) => JSON.stringify((a || []).map(x => String(x).trim()).filter(Boolean)) === JSON.stringify(b || []);
  const usedLines = same(recipe.ingredients, r.lines);
  const m = r.macros;
  const usedMacros = m && ['kcal', 'protein', 'carbs', 'fat'].every(k => Math.round(recipe[k] || 0) === m[k]);
  return (
    <div className={`upg-vread${r.source === 'inferred' ? ' is-guess' : ''}`}>
      <div className="upg-vread-head">
        <span className="upg-field-lbl">Ingredients from the video</span>
        <span className="upg-vread-src">
          {r.source === 'description' ? 'from the description' : r.source === 'inferred' ? 'a typical version, check the video' : 'none found'}
          {r.servings ? ` · makes ${r.servings}` : ''}
        </span>
      </div>
      {r.lines.length > 0 ? (
        <ul className="upg-vread-list">{r.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      ) : <div className="upg-fine">The video doesn’t list its ingredients. Add them by hand.</div>}
      {m && (
        <div className="upg-vread-macros">
          ≈ {m.kcal} kcal · <b>{m.protein} g protein</b> · {m.carbs} c · {m.fat} f per serving <span className="upg-est">estimate</span>
        </div>
      )}
      {r.note && <div className="upg-fine">{r.note}</div>}
      <div className="upg-vread-acts">
        {r.lines.length > 0 && !usedLines && (
          <button type="button" className="link-open-btn" onClick={() => onChange({ ingredients: r.lines, ...(r.servings ? { servings: r.servings } : {}) })}>
            {(recipe.ingredients || []).some(l => String(l).trim()) ? 'Replace my ingredients' : 'Use these ingredients'}
          </button>
        )}
        {m && !usedMacros && (
          <button type="button" className="upg-textbtn" onClick={() => onChange({ ...m, macrosEstimated: true })}>Use the macro estimate</button>
        )}
        <button type="button" className="upg-textbtn" onClick={onRead}>Read again</button>
      </div>
      {error && <div className="upg-fine" style={{ color: '#e0796a' }}>{error}</div>}
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
