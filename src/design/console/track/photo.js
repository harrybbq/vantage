/**
 * A picked cover photo, resized on the device before it is stored —
 * the same treatment as the classic ImageField (components/Modals.jsx):
 * long edge `max` px, JPEG at 0.78, kept as a data URL in the SAME
 * `imageUrl` field a pasted link uses, so the user_data blob stays lean
 * and every trip surface renders either form.
 */
export function resizePhoto(file, max = 900) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('no file')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = ev => {
      const img = new Image();
      img.onerror = () => reject(new Error('not an image'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}
