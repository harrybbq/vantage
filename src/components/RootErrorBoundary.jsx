/**
 * Root error boundary.
 *
 * React 18 unmounts the ENTIRE root when a render or lifecycle error
 * goes uncaught. For a full-screen app that means the interface simply
 * vanishes — the user sees the app for a moment and then a blank
 * screen, with nothing to read and nothing to tap. There was no
 * boundary anywhere in this tree, so every component error had that
 * outcome.
 *
 * This does not fix any particular bug. It makes the failure legible
 * and recoverable: the error and the component that threw are shown, so
 * a report can name the cause, and the user gets a reload rather than a
 * dead screen.
 *
 * Deliberately NOT wrapped around small subtrees — one widget throwing
 * should ideally take down only itself, but a boundary per widget is a
 * larger change and this is the one that stops the whole app going
 * dark.
 */
import { Component } from 'react';

const wrap = {
  minHeight: '100dvh', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 14,
  padding: 32, textAlign: 'center', background: 'var(--bg, #141412)',
  fontFamily: 'var(--mono, ui-monospace, Menlo, monospace)',
  color: 'var(--text-muted, #8a8a85)',
};

export default class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Kept on window so it survives the re-render and can be read from a
    // console or a screenshot without expanding anything.
    if (typeof window !== 'undefined') {
      window.__vantageLastError = {
        message: error?.message || String(error),
        stack: error?.stack,
        componentStack: info?.componentStack,
      };
    }
    console.error('[Vantage] Uncaught render error:', error, info?.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    // First app component in the stack — usually the one at fault, and
    // far more useful in a bug report than the message alone.
    const culprit = (info?.componentStack || '')
      .split('\n').map(l => l.trim()).filter(Boolean)
      .find(l => /^(at|in)\s+[A-Z]/.test(l)) || '';

    return (
      <div style={wrap}>
        <div style={{ fontSize: 13, letterSpacing: 2, color: '#d99114' }}>SOMETHING BROKE</div>
        <div style={{ maxWidth: '34em', fontSize: 12, lineHeight: 1.7, color: 'var(--text, #c9c9c2)' }}>
          {error.message || String(error)}
        </div>
        {culprit && (
          <div style={{ fontSize: 10.5, opacity: 0.8, wordBreak: 'break-word', maxWidth: '34em' }}>
            {culprit}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ font: 'inherit', fontSize: 12, padding: '9px 18px', borderRadius: 8,
                     border: '1px solid #2f6b4f', background: 'transparent', color: '#3f9a6f', cursor: 'pointer' }}
          >Reload</button>
          <button
            type="button"
            onClick={() => this.setState({ error: null, info: null })}
            style={{ font: 'inherit', fontSize: 12, padding: '9px 18px', borderRadius: 8,
                     border: '1px solid var(--border, #35352f)', background: 'transparent',
                     color: 'var(--text-muted, #8a8a85)', cursor: 'pointer' }}
          >Try again</button>
        </div>
        <div style={{ fontSize: 10, opacity: 0.75, maxWidth: '30em', lineHeight: 1.6 }}>
          Your data is safe — it lives on the server, and nothing here writes to it.
        </div>
      </div>
    );
  }
}
