/**
 * Reading a saved video's recipe (netlify/functions/recipe-from-video).
 *
 * The read is stored on the video (`video.read`) and folded into a
 * recipe by meals.js → applyRead / fillFromRead, which are pure.
 */
import { authFetch } from '../authFetch';
import { toLine } from './ingredients';

export async function readVideoRecipe(url) {
  try {
    const res = await authFetch('/.netlify/functions/recipe-from-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || (res.status === 401 ? 'Sign in again to read videos.' : 'Couldn’t read that video.') };
    return {
      read: {
        title: body.title || '',
        servings: body.servings || null,
        lines: (body.ingredients || []).map(toLine).filter(Boolean),
        macros: body.macros || null,
        source: body.source || 'none',
        confidence: body.confidence || 'low',
        note: body.note || '',
        at: Date.now(),
      },
    };
  } catch {
    return { error: 'Couldn’t reach the server. Check your connection.' };
  }
}
