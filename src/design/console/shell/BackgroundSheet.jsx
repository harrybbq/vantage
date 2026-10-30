/**
 * Background for the page you're on, in the console design.
 *
 * The same per-section photos as classic: `S.backgrounds[section]` and
 * `S.bgFx[section]` ({ dim, blur }), so a photo set in either design
 * shows in both. App owns the writes (the file picker, the crop modal,
 * remove, and the dim and blur values); this sheet only offers them.
 *
 * Opened from the shell's image button (desktop top bar, phone app bar).
 */
import Icon from '../../../components/Icon';
import { Sheet } from '../ui';

export default function BackgroundSheet({ title, photo, fx, onChoose, onRemove, onFx, onClose }) {
  const dim = Math.round((fx && fx.dim) || 0);
  const blur = Math.round((fx && fx.blur) || 0);
  return (
    <Sheet title="Background" eyebrow={title} onClose={onClose} testId="cx-shell-bg" className="cx-shell-bg" width={400}>
      <div className="cx-shell-bg-body">
        <div className={`cx-shell-bg-preview${photo ? '' : ' is-empty'}`} aria-hidden="true">
          {photo
            ? <img src={photo} alt="" style={{ filter: blur ? `blur(${Math.min(blur, 12)}px)` : undefined }} />
            : <Icon name="image" size={22} strokeWidth={1.5} />}
          {photo && dim > 0 && <span className="cx-shell-bg-preview-dim" style={{ opacity: dim / 100 }} />}
        </div>
        <p className="cx-t13 cx-muted cx-shell-bg-note">
          {photo
            ? 'Shown behind this page only, on every device you sign in on.'
            : 'Pick a photo for this page. Each page can have its own.'}
        </p>
        <div className="cx-shell-bg-actions">
          <button type="button" className="cx-btn cx-btn--primary" onClick={onChoose}>
            <Icon name="upload" size={16} strokeWidth={1.75} />{photo ? 'Replace photo' : 'Choose a photo'}
          </button>
          {photo && (
            <button type="button" className="cx-btn" onClick={onRemove}>
              <Icon name="trash-2" size={16} strokeWidth={1.75} />Remove
            </button>
          )}
        </div>
        {photo && (
          <div className="cx-shell-bg-fx">
            <label className="cx-shell-bg-range">
              <span className="cx-shell-bg-range-head"><span>Dim</span><span className="cx-num">{dim}%</span></span>
              <input type="range" min="0" max="80" step="1" value={dim}
                     onChange={e => onFx({ dim: Number(e.target.value), blur })} />
            </label>
            <label className="cx-shell-bg-range">
              <span className="cx-shell-bg-range-head"><span>Blur</span><span className="cx-num">{blur} px</span></span>
              <input type="range" min="0" max="40" step="1" value={blur}
                     onChange={e => onFx({ dim, blur: Number(e.target.value) })} />
            </label>
          </div>
        )}
      </div>
    </Sheet>
  );
}
