/**
 * Netlify: what is live, how the last deploys went, and how the app
 * feels to real people (our own 1-in-5 sampled web vitals, p75).
 *
 * Netlify has no API for Observability, function metrics or bandwidth,
 * so those are link-outs (the backend sends `links`; hidden if absent),
 * not numbers we would have to invent.
 *
 * Deploys read like Netlify's own list: "Production: master@a1b2c3d" +
 * state pill, the commit message muted under it, time and "Deployed in
 * 1m 24s" on the right. Vitals follow Vercel Speed Insights: a rail of
 * metric cards with the value coloured by web.dev's bands, then the
 * pages for the selected metric in three buckets — Poor / Needs
 * improvement / Great — with each bucket's threshold in its header.
 */
import { useState } from 'react';
import Icon from '../../Icon';
import { usePanel } from './usePanel';
import { Updated, Gate, CardHead, Pill, SetupCard, NoData } from './parts';
import { part, deployPill, deployHeadline, deployDuration, safeHref } from '../../../lib/security/status';
import { VITALS, rateVital, fmtVital, overallRating, RATING_LABEL, bucketHeads, bucketRows, vitalSentence } from '../../../lib/security/vitals';
import { ago, stamp, fmtDuration, fmtInt, fmtMs, num, shortSha } from '../../../lib/security/format';

const ENVS = ['NETLIFY_AUTH_TOKEN'];
const MIN_SAMPLES = 20;

function Current({ site }) {
  const p = deployPill(site.state);
  const url = safeHref(site.url);
  return (
    <section className={`sec-card sec-live is-${p.key}`}>
      <CardHead eyebrow="// live now" title={site.name || 'Site'} right={<Pill p={p} />} />
      <div className="sec-live-rows">
        <div><span>Published</span><b title={stamp(site.publishedAt)}>{ago(site.publishedAt)}</b></div>
        <div><span>Branch</span><b className="is-mono">{site.branch || '—'}</b></div>
        <div><span>Commit</span><b className="is-mono">{shortSha(site.commit) || '—'}</b></div>
      </div>
      {url && <a className="sec-link" href={url} target="_blank" rel="noopener noreferrer">{url.replace(/^https:\/\//, '')} <Icon name="external-link" size={10} /></a>}
    </section>
  );
}

function Deploys({ list }) {
  const [open, setOpen] = useState(null);
  const rows = (Array.isArray(list) ? list : []).filter(d => d && typeof d === 'object');
  if (!rows.length) return <NoData>No deploys reported yet.</NoData>;
  return (
    <div className="sec-tlist">
      {rows.map((d, i) => {
        const p = deployPill(d.state);
        const t = deployDuration(d);
        const id = d.id || i;
        const isOpen = open === id;
        const more = !!d.errorMessage;
        return (
          <div key={id} className="sec-titem">
            <button type="button" className={`sec-row sec-dep is-${p.key}${isOpen ? ' is-open' : ''}${more ? '' : ' is-static'}`}
                    onClick={() => more && setOpen(isOpen ? null : id)} aria-expanded={more ? isOpen : undefined}>
              <span className="sec-row-main">
                <span className="sec-row-top">
                  <b className="sec-row-id is-mono">{deployHeadline(d)}</b>
                  <Pill p={p} />
                </span>
                <span className="sec-row-sub">{d.title || 'No commit message'}</span>
              </span>
              <span className="sec-row-side">
                <span title={stamp(d.createdAt)}>{ago(d.createdAt)}</span>
                <span className="sec-row-faint is-mono">{t != null ? `${p.key === 'down' ? 'Failed after' : 'Deployed in'} ${fmtDuration(t)}` : p.key === 'busy' ? 'in progress' : '—'}</span>
              </span>
              {more ? <Icon name="chevron-right" size={14} className="sec-row-chev" /> : <span className="sec-row-chev" />}
            </button>
            {isOpen && <div className="sec-drawer"><div className="sec-dep-err">{String(d.errorMessage).slice(0, 600)}</div></div>}
          </div>
        );
      })}
    </div>
  );
}

function pageRows(w, id) {
  return (Array.isArray(w.byPage) ? w.byPage : []).filter(r => r && (r.path || r.page)).map(r => {
    const p = r.p75 && typeof r.p75 === 'object' ? r.p75 : r;
    return { path: r.path || r.page, samples: num(r.samples ?? r.count), value: p[id] };
  });
}

function Vitals({ w }) {
  const [metric, setMetric] = useState('lcp');
  const p75 = w.p75 || {};
  const samples = num(w.samples);
  if (!samples) return <NoData>No page loads sampled yet. 1 in 5 visits sends one beacon; give it a day of traffic.</NoData>;
  const verdict = overallRating(p75);
  const share = (w.goodShare && typeof w.goodShare === 'object' ? w.goodShare : {})[metric];
  const heads = bucketHeads(metric);
  const buckets = bucketRows(metric, pageRows(w, metric));
  const m = VITALS.find(v => v.id === metric);
  return (
    <>
      <div className="sec-vitals-head">
        <span className="sec-src">p75 · last {num(w.windowDays) || 7} days · {fmtInt(samples)} page loads (1 in 5 sampled)</span>
        {verdict && <span className={`sec-rate is-${verdict}`}><i aria-hidden="true" />Core Web Vitals: {RATING_LABEL[verdict]}</span>}
      </div>
      {samples < MIN_SAMPLES && (
        <div className="sec-note">Fewer than {MIN_SAMPLES} loads in the window — read these as a hint, not a verdict.</div>
      )}
      <div className="sec-vgrid">
        <div className="sec-vrail" role="tablist" aria-label="Metric">
          {VITALS.map(v => {
            const r = rateVital(v.id, p75[v.id]);
            return (
              <button key={v.id} type="button" role="tab" aria-selected={metric === v.id}
                      className={`sec-vcard${metric === v.id ? ' is-on' : ''}`} onClick={() => setMetric(v.id)}>
                <span className="sec-vcard-name" title={v.long}>{v.name}{v.core && <em>CWV</em>}</span>
                <b className={`sec-num is-${r || 'none'}`}>{fmtVital(v.id, p75[v.id])}</b>
                <span className={`sec-rate is-${r || 'none'}`}><i aria-hidden="true" />{r ? RATING_LABEL[r] : 'no data'}</span>
              </button>
            );
          })}
        </div>
        <div className="sec-vmain">
          <div className="sec-vmain-head">
            <span className="sec-eyebrow">// {m.long}</span>
            <p className="sec-vsentence">{vitalSentence(metric, p75[metric], share)}</p>
          </div>
          <div className="sec-buckets">
            {['poor', 'ni', 'good'].map(k => (
              <div key={k} className={`sec-bucket is-${k}`}>
                <div className="sec-bucket-head"><i aria-hidden="true" /><b>{RATING_LABEL[k]}</b><span>{heads[k]}</span></div>
                {buckets[k].length === 0
                  ? <div className="sec-bucket-empty">{k === 'good' ? 'No pages here yet.' : `No ${RATING_LABEL[k].toLowerCase()} pages.`}</div>
                  : buckets[k].map(r => (
                    <div key={r.path} className="sec-bucket-row">
                      <span className="is-mono sec-bucket-path" title={r.path}>{r.path}</span>
                      <span className="is-mono sec-bucket-val">{fmtVital(metric, r.value)}</span>
                      <span className="sec-bucket-n">{fmtInt(r.samples)} loads</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
          {buckets.none.length > 0 && (
            <div className="sec-fine">{buckets.none.length} page{buckets.none.length === 1 ? '' : 's'} with no {m.name} sample yet.</div>
          )}
        </div>
      </div>
    </>
  );
}

function section(p, render, envs) {
  if (p.state === 'ok') return render(p.data);
  if (p.state === 'not_configured') return <SetupCard envs={envs} hint={p.hint} />;
  if (p.state === 'missing') return <NoData />;
  return <div className="sec-note is-warn"><b>Unavailable right now.</b> {p.hint || ''}</div>;
}

export default function NetlifyPanel() {
  const nf = usePanel('netlify');
  const links = nf.res && nf.res.state === 'ok' && nf.res.data.links && typeof nf.res.data.links === 'object' ? nf.res.data.links : {};
  const obs = safeHref(links.observability), waf = safeHref(links.security || links.webSecurity);
  return (
    <div className="sec-pane">
      <div className="sec-bar">
        <span className="sec-eyebrow">// netlify · real users</span>
        <Updated at={nf.updatedAt} loading={nf.loading} onRefresh={nf.reload} error={nf.res && nf.res.staleError} />
      </div>
      {(obs || waf) && (
        <div className="sec-linkouts">
          {obs && <a className="sec-btn" href={obs} target="_blank" rel="noopener noreferrer">Open Netlify Observability <Icon name="external-link" size={11} /></a>}
          {waf && <a className="sec-btn" href={waf} target="_blank" rel="noopener noreferrer">Open Web security center <Icon name="external-link" size={11} /></a>}
          <span className="sec-fine">Requests, status codes and blocked traffic live there — Netlify has no API for them.</span>
        </div>
      )}
      <Gate res={nf.res} envs={ENVS}>
        {data => {
          const site = part(data.site);
          const deploys = part(data.deploys);
          const vitals = part(data.webVitals);
          const fns = data.functions && typeof data.functions === 'object' && data.functions.ok !== false ? data.functions : null;
          const health = data.health && typeof data.health === 'object' ? data.health : null;
          return (
            <>
              <div className="sec-two is-wide-left">
                {site.state === 'ok'
                  ? <Current site={site.data} />
                  : <section className="sec-card"><CardHead eyebrow="// live now" title="Site" />{section(site, () => null, ENVS)}</section>}
                <section className="sec-card">
                  <CardHead eyebrow="// runtime" title="Functions" />
                  <div className="sec-live-rows">
                    <div><span>Health check</span><b>{health ? <Pill p={health.ok === false ? { key: 'down', label: 'Failing' } : health.ok ? { key: 'ok', label: 'Passing' } : { key: 'unknown', label: 'Unknown' }} /> : '—'}</b></div>
                    <div><span>DB round trip</span><b>{health ? fmtMs(health.dbMs) : '—'}</b></div>
                    <div><span>Functions live</span><b>{fns ? fmtInt(fns.count ?? (fns.names || []).length) : '—'}</b></div>
                  </div>
                  {fns && Array.isArray(fns.names) && fns.names.length > 0 && (
                    <details className="sec-fns">
                      <summary>Names</summary>
                      <div className="sec-fn-list">{fns.names.slice(0, 80).map(n => <code key={n}>{n}</code>)}</div>
                    </details>
                  )}
                </section>
              </div>

              <section className="sec-card">
                <CardHead eyebrow="// newest first" title="Deploys" />
                {section(deploys, d => <Deploys list={d} />, ENVS)}
              </section>

              <section className="sec-card">
                <CardHead eyebrow="// field data · our own beacon" title="Web vitals" />
                {section(vitals, w => <Vitals w={w} />, [])}
              </section>
            </>
          );
        }}
      </Gate>
    </div>
  );
}
