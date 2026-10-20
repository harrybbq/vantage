import { APP_STORE_URL, PLAY_STORE_URL, storeHref } from '../../lib/storeLinks';
import './webaccess.css';

/**
 * Two store buttons — or, while lib/storeLinks.js still holds null, the
 * same two shapes reading "Coming soon". Used by the web gate page and
 * the invite landing. No store logos: Apple's and Google's badge artwork
 * has its own licence terms; drop the official badges in here once the
 * listings exist.
 */
const STORES = [
  { id: 'ios', url: APP_STORE_URL, small: 'Download on the', big: 'App Store', soon: 'Coming soon to the', device: 'iPhone' },
  { id: 'android', url: PLAY_STORE_URL, small: 'Get it on', big: 'Google Play', soon: 'Coming soon to', device: 'Android' },
];

export default function StoreLinks({ compact = false }) {
  return (
    <div className={'wa-stores' + (compact ? ' wa-stores-compact' : '')}>
      {STORES.map(s => {
        const href = storeHref(s.url);
        const body = (
          <>
            <span className="wa-store-small">{href ? s.small : s.soon}</span>
            <span className="wa-store-big">{s.big}</span>
          </>
        );
        return href ? (
          <a key={s.id} className="wa-store" href={href} target="_blank" rel="noopener noreferrer"
            aria-label={`${s.small} ${s.big} (${s.device})`}>
            {body}
          </a>
        ) : (
          <div key={s.id} className="wa-store wa-store-soon" aria-label={`${s.soon} ${s.big}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
