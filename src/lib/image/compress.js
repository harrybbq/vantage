/**
 * Image downscaling for anything that ends up in the synced state or the
 * user_data row. Browser-only (Image + canvas).
 */

/**
 * Downscale a base64/data-URL image to a sane size so syncing it in the
 * state blob doesn't bloat every save. Max 1600px on the long edge,
 * JPEG @ 0.72. Resolves to a data URL (or the original on failure).
 *
 * Used for backgrounds, where keeping the original on a decode failure
 * is the right call — the user just picked it and can see it.
 */
export function compressImageDataUrl(dataUrl, max = 1600, quality = 0.72) {
  return new Promise(resolve => {
    try {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch { resolve(dataUrl); }
  });
}

/** Long edge of a stored profile photo. It renders at 28–120px. */
export const PHOTO_MAX_PX = 512;

/**
 * A profile photo, ready to store: at most 512px on the long edge, WebP
 * where the browser can encode it and JPEG where it can't (Safari before
 * 14 hands back a PNG for 'image/webp', which is detected and redone).
 *
 * History (2026-09-30, audit item 59): the photo went into user_data as
 * the raw FileReader result — a phone camera's 5 MB — and was re-sent
 * with every save and re-downloaded with every poll.
 *
 * Resolves null when the file can't be decoded (HEIC on most desktop
 * browsers). Unlike backgrounds the original is NOT kept: it would be
 * the full-size blob this exists to stop, and a browser that can't
 * decode it can't display it either. Callers tell the user instead.
 */
export function compressPhotoDataUrl(dataUrl, max = PHOTO_MAX_PX) {
  return new Promise(resolve => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          if (!img.width || !img.height) { resolve(null); return; }
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const webp = canvas.toDataURL('image/webp', 0.82);
          if (webp.startsWith('data:image/webp')) { resolve(webp); return; }
          // JPEG has no alpha: paint a transparent PNG onto white rather
          // than letting it turn black.
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch { resolve(null); }
  });
}

/** Read a picked File and hand back a store-ready photo (or null). */
export function readPhotoFile(file) {
  return new Promise(resolve => {
    if (!file) { resolve(null); return; }
    const r = new FileReader();
    r.onload = ev => { compressPhotoDataUrl(ev.target.result).then(resolve); };
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}
