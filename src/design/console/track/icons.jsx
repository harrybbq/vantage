/**
 * Icons the shared Lucide set (components/Icon.jsx) lacks, drawn the
 * same way (24-box, round caps, currentColor). Anything else falls
 * through to the shared Icon. Local to TRACK so Icon.jsx stays untouched;
 * listed in NOTES.md for consolidation.
 */
import Icon from '../../../components/Icon';

const EXTRA = {
  pin: <><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  'pound': <><path d="M18 7c0-5.333-8-5.333-8 0" /><path d="M10 7v14" /><path d="M6 21h12" /><path d="M6 13h10" /></>,
};

export default function TIcon({ name, size = 16, strokeWidth = 1.75, className, style }) {
  const body = EXTRA[name];
  if (!body) return <Icon name={name} size={size} strokeWidth={strokeWidth} className={className} style={style} />;
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {body}
    </svg>
  );
}
