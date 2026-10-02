// STUB — replaced by the data agent's version at merge
/**
 * Contract stub: useHomeLines(S, userId) → { hero: { sub, state }, cards: { career, diet, rotation, security } }
 * Card = { loading, figure, figureLabel, text, state, updatedAt, error, retry }
 */
const MIN = 60000;

// eslint-disable-next-line no-unused-vars
export function useHomeLines(S, userId) {
  const now = Date.now();
  return {
    hero: { sub: 'Fri 2 Oct · Off · Rest · 1 ticket open', state: 'attention' },
    cards: {
      career: { loading: false, figure: '90 d', figureLabel: 'to exam', text: 'Brief · Send the CV to two recruiters', state: 'neutral', updatedAt: now - 4 * MIN, error: null, retry: null },
      diet: { loading: false, figure: '40 g', figureLabel: 'protein to go', text: '182 g target today · 142 g logged', state: 'neutral', updatedAt: now - 2 * MIN, error: null, retry: null },
      rotation: { loading: false, figure: 'Off', figureLabel: 'today', text: 'Rest', state: 'neutral', updatedAt: null, error: null, retry: null },
      security: { loading: false, figure: '1 open', figureLabel: 'tickets', text: '1 ticket open · all systems ok', state: 'attention', updatedAt: now - MIN, error: null, retry: null },
    },
  };
}
