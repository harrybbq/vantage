/**
 * A crash in one widget takes down that widget, not the app.
 *
 * RootErrorBoundary catches everything, but "everything" is the problem:
 * one hub widget throwing on an odd value in state replaced the whole
 * app with an error screen — a dead app for a store reviewer, and for a
 * user whose data was fine everywhere else. So each hub widget (desktop
 * islands and the mobile stack) and each top-level section gets its own
 * boundary. The rest of the page keeps working, the failure is reported,
 * and "Reload widget" remounts just the broken subtree.
 *
 * Like every React boundary this only sees errors thrown while
 * RENDERING (and in lifecycle methods). A throw inside a click handler
 * or a promise goes to window.onerror / unhandledrejection instead,
 * which reportError's global handlers pick up.
 *
 * Deliberately dumb: no state access, no retries of its own, nothing
 * that could itself throw while the tree below it is already broken.
 */
import { Component } from 'react';
import { reportError } from '../lib/telemetry/reportError';

const card = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
  padding: '12px 14px', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box',
  fontFamily: 'var(--mono, ui-monospace, Menlo, monospace)', fontSize: 11,
  lineHeight: 1.5, color: 'var(--text-muted, #8a8a85)',
};
const sectionCard = {
  ...card, alignItems: 'center', textAlign: 'center', padding: '48px 16px', gap: 12,
};
const btn = {
  font: 'inherit', fontSize: 11, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
  background: 'transparent', color: 'var(--em, #1a7a4a)',
  border: '1px solid var(--border, rgba(128,128,128,.35))',
};

export default class WidgetBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, attempt: 0 };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const where = this.props.name ? `${this.props.variant === 'section' ? 'section' : 'widget'}:${this.props.name}` : 'widget';
    try {
      console.error(`[Vantage] ${where} crashed:`, error, info?.componentStack);
      // The component stack says WHICH widget, which the message alone
      // rarely does. Folded into the stack so the report stays one row.
      const message = error?.message || String(error);
      const stack = `${error?.stack || message}${info?.componentStack ? `\n--- component stack ---${info.componentStack}` : ''}`;
      reportError(where, { message, stack });
    } catch { /* reporting must never re-throw here */ }
  }

  reset() {
    // A new key on the wrapper remounts the subtree from scratch, so a
    // widget stuck in a bad internal state starts clean.
    this.setState(s => ({ error: null, attempt: s.attempt + 1 }));
  }

  render() {
    const { error, attempt } = this.state;
    const { children, variant } = this.props;
    if (!error) return <WidgetKey key={attempt}>{children}</WidgetKey>;

    const isSection = variant === 'section';
    return (
      <div role="alert" className="widget-boundary" style={isSection ? sectionCard : card}>
        <span style={{ color: 'var(--text, #c9c9c2)' }}>
          {isSection ? 'This page hit a snag.' : 'This widget hit a snag.'}
        </span>
        {isSection && <span>Everything else still works — your data is safe.</span>}
        <button type="button" style={btn} onClick={this.reset}>
          {isSection ? 'Reload page' : 'Reload widget'}
        </button>
      </div>
    );
  }
}

/* A keyed pass-through, so bumping `attempt` remounts the children. */
function WidgetKey({ children }) {
  return children ?? null;
}
