/**
 * Getting a group picture down to a size worth storing.
 *
 * The picture lives in a text column on a row that is read every time a
 * division table is drawn — twenty groups a board, on a Micro instance.
 * So it is small on purpose: 160px square, JPEG, which lands around
 * 10-20 KB. Anything the user picked is cropped to a square from the
 * centre first, because it is drawn in a circle and a letterboxed
 * rectangle inside a circle looks like a mistake.
 *
 * ── The limits here are not the security ─────────────────────────────
 * netlify/lib/imageModeration.js checks type and size again, server-side
 * and independently. That duplication is deliberate: this file makes the
 * common case small and fast, and the server assumes none of it happened
 * — anyone can POST whatever they like to a function, and a check that
 * only runs in the browser is a suggestion.
 */

/** 160 square: twice the largest size it is ever drawn at (40px on the
 *  division table, 72px on the group card), so it stays sharp on a
 *  retina screen and no sharper. */
export const CREST_PX = 160;
export const CREST_QUALITY = 0.82;

/** What the file picker should offer, and what the server accepts. */
export const CREST_ACCEPT = 'image/jpeg,image/png,image/webp';

/** The ceiling the server enforces, in base64 characters. Mirrored from
 *  imageModeration.js so the client can say "too big" before spending a
 *  round trip on it. */
export const MAX_BASE64_CHARS = 260_000;

/** Bytes of the actual image inside a base64 data URL. */
export function base64Chars(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const i = dataUrl.indexOf(',');
  return i === -1 ? 0 : dataUrl.length - i - 1;
}

/**
 * Why this file cannot be used, or null when it can.
 *
 * Checked before anything is read, so a 40 MB RAW file is refused in
 * the moment rather than after the browser has decoded it.
 */
export function rejectReason(file) {
  if (!file) return 'Choose an image.';
  if (!/^image\/(jpeg|png|webp)$/.test(file.type || '')) return 'Use a JPEG, PNG or WebP.';
  // 12 MB of source. Anything larger is a camera original, and decoding
  // one on a phone to make a 160px square is a way to run out of memory.
  if (file.size > 12 * 1024 * 1024) return 'That image is too large — try one under 12 MB.';
  return null;
}

/**
 * File → a square 160px JPEG data URL.
 *
 * Centre-cropped to the shorter side before scaling, so a portrait
 * photograph loses its edges rather than being squashed.
 *
 * Needs a DOM (Image + canvas); the caller is a click handler, so that
 * is where it is.
 */
export function toCrestDataUrl(file, { px = CREST_PX, quality = CREST_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    const reason = rejectReason(file);
    if (reason) { reject(new Error(reason)); return; }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const side = Math.min(img.width, img.height);
        if (!side) { reject(new Error('That image is empty.')); return; }
        const sx = Math.floor((img.width - side) / 2);
        const sy = Math.floor((img.height - side) / 2);
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext('2d');
        // A transparent PNG becomes a JPEG here, and JPEG has no alpha —
        // without this the transparent parts come out black.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, px, px);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, px, px);
        const out = canvas.toDataURL('image/jpeg', quality);
        if (base64Chars(out) > MAX_BASE64_CHARS) {
          reject(new Error('That image is too detailed to store — try a simpler one.'));
          return;
        }
        resolve(out);
      } catch {
        reject(new Error('Could not read that image.'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

/**
 * What the leader should be told about their picture's state.
 *
 * Returns null when there is nothing to say — an approved picture needs
 * no label, and neither does no picture at all.
 */
export function crestStatusNote(status, note) {
  if (status === 'pending') {
    return { tone: 'wait', text: 'Waiting to be checked — only your group can see it until then.' };
  }
  if (status === 'rejected') {
    return { tone: 'bad', text: note ? `Not approved: ${note}` : 'Not approved. Only your group can see it.' };
  }
  return null;
}
