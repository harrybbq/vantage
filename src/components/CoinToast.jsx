/**
 * The little pill that confirms a coin earn or spend.
 *
 * `action` is optional and exists for one reason: a toast that announces
 * something you'd want to go and look at is a dead end without it. The
 * vision-unlock toast used to say "Vision unlocked: Early Riser" and
 * then vanish, leaving the catalogue buried in Settings — a playtester
 * hit exactly that and never found the list.
 */
export default function CoinToast({ message, type, visible, action }) {
  // type: 'earn' | 'spend' | 'error'
  return (
    <div id="coinToast" className={`${type || ''} ${visible ? 'show' : ''}`}>
      {type === 'earn' && <span className="coin-toast-icon" aria-hidden="true">⬡</span>}
      {message}
      {action && (
        <button
          type="button"
          className="coin-toast-action"
          // The toast itself is pointer-events:none so it never eats a
          // click aimed at the page underneath. The button opts back in.
          onClick={action.onClick}
        >
          {action.label} →
        </button>
      )}
    </div>
  );
}
