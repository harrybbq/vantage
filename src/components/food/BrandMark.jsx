/**
 * Brand mark for a food search result.
 *
 * Three tiers, best first:
 *   1. The product photo Open Food Facts holds for that barcode. Real,
 *      free, and usually the branded packaging — the most informative
 *      thing available.
 *   2. For chains OFF has no packaging shot for (a Big Mac isn't a
 *      barcoded product), the brand's own favicon via Google's public
 *      s2 service. That returns the company's actual mark, needs no
 *      API key, and is a plain <img> so it costs nothing until it
 *      renders.
 *   3. A coloured initial chip, so every row still has an anchor and
 *      the list doesn't look ragged.
 *
 * On why not bundled logo files: shipping third-party trademarked
 * artwork in the app bundle is a licensing question, not a technical
 * one. Referencing a company's own favicon to identify their product
 * is ordinary nominative use and carries no such baggage.
 *
 * Everything fails soft — a broken image hides itself and drops to the
 * next tier, so a result row never breaks over decoration.
 */
import { useState } from 'react';

// Brand → primary domain, for the favicon lookup. Matching is done on a
// normalised, punctuation-stripped name so "McDonald's" and "mcdonalds"
// both land. Ordered longest-first at match time so "burger king"
// doesn't get grabbed by a shorter key.
const BRAND_DOMAINS = {
  mcdonalds: 'mcdonalds.com',
  burgerking: 'burgerking.com',
  kfc: 'kfc.com',
  subway: 'subway.com',
  greggs: 'greggs.co.uk',
  nandos: 'nandos.co.uk',
  dominos: 'dominos.com',
  pizzahut: 'pizzahut.com',
  starbucks: 'starbucks.com',
  costa: 'costa.co.uk',
  pret: 'pret.co.uk',
  wagamama: 'wagamama.com',
  five_guys: 'fiveguys.com',
  fiveguys: 'fiveguys.com',
  wendys: 'wendys.com',
  tacobell: 'tacobell.com',
  chipotle: 'chipotle.com',
  papajohns: 'papajohns.com',
  itsu: 'itsu.com',
  leon: 'leon.co',
  wasabi: 'wasabi.uk.com',
  tesco: 'tesco.com',
  sainsburys: 'sainsburys.co.uk',
  asda: 'asda.com',
  morrisons: 'morrisons.com',
  aldi: 'aldi.co.uk',
  lidl: 'lidl.co.uk',
  waitrose: 'waitrose.com',
  cooperative: 'coop.co.uk',
  coop: 'coop.co.uk',
  mands: 'marksandspencer.com',
  marksandspencer: 'marksandspencer.com',
  nestle: 'nestle.com',
  cadbury: 'cadbury.co.uk',
  walkers: 'walkers.co.uk',
  kelloggs: 'kelloggs.com',
  danone: 'danone.com',
  heinz: 'heinz.com',
  coca_cola: 'coca-cola.com',
  cocacola: 'coca-cola.com',
  pepsi: 'pepsi.com',
  innocent: 'innocentdrinks.co.uk',
  huel: 'huel.com',
  myprotein: 'myprotein.com',
  grenade: 'grenade.com',
  quorn: 'quorn.co.uk',
  alpro: 'alpro.com',
  mullerlight: 'muller.co.uk',
  muller: 'muller.co.uk',
  arla: 'arla.co.uk',
  yeovalley: 'yeovalley.co.uk',
  warburtons: 'warburtons.co.uk',
  hovis: 'hovis.co.uk',
};

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Domain for a brand string, or null. Longest key wins. */
export function brandDomain(brand) {
  const n = norm(brand);
  if (!n) return null;
  if (BRAND_DOMAINS[n]) return BRAND_DOMAINS[n];
  const keys = Object.keys(BRAND_DOMAINS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (n.includes(norm(k))) return BRAND_DOMAINS[k];
  }
  return null;
}

// Deterministic colour per brand so the same brand always gets the same
// chip — a stable cue rather than random confetti.
const CHIP_COLOURS = ['#e5484d', '#f5a524', '#2fa96b', '#2d6cdf', '#7a4fd0', '#d0498f', '#12a5a5'];
function chipColour(seed) {
  const n = norm(seed) || '?';
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return CHIP_COLOURS[h % CHIP_COLOURS.length];
}

export function BrandMark({ brand, name, image, size = 34 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);

  const domain = brandDomain(brand);
  const label = (brand || name || '?').trim();
  const initial = (label[0] || '?').toUpperCase();

  const box = {
    width: size, height: size, flexShrink: 0, borderRadius: 8,
    overflow: 'hidden', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'var(--surface)',
    border: 'var(--border-card)',
  };

  if (image && !imgFailed) {
    return (
      <div style={box} aria-hidden="true">
        <img src={image} alt="" loading="lazy" onError={() => setImgFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  if (domain && !iconFailed) {
    return (
      <div style={box} title={brand || undefined}>
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt={brand ? `${brand} logo` : ''}
          loading="lazy"
          onError={() => setIconFailed(true)}
          style={{ width: size - 12, height: size - 12, objectFit: 'contain' }}
        />
      </div>
    );
  }

  return (
    <div style={{ ...box, background: chipColour(label), border: 'none' }} aria-hidden="true">
      <span style={{
        fontFamily: 'var(--sans)', fontWeight: 700, fontSize: size * 0.42, color: '#fff',
      }}>{initial}</span>
    </div>
  );
}
