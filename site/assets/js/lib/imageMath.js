// Image sizing rules (no browser needed, so they can be tested).

export const FULL_MAX = 2000;      // long side of the stored image, in pixels
export const DOC_MAX = 2400;       // scanned documents keep a bit more detail for reading
export const THUMB_MAX = 420;      // long side of thumbnails
export const FULL_TARGET = 300 * 1024;
export const DOC_TARGET = 450 * 1024;
export const THUMB_TARGET = 40 * 1024;
export const QUALITIES = [0.86, 0.8, 0.72, 0.64, 0.56, 0.5];

/** Scale (w, h) down so the long side is at most max. Never enlarges. */
export function fitWithin(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * Try lower and lower JPEG quality until the result is at most `target` bytes.
 * encode(quality) => Promise<{ size }>. Returns the first small-enough result,
 * or the smallest one if none is.
 */
export async function encodeToTarget(encode, target, qualities = QUALITIES) {
  let last = null;
  for (const q of qualities) {
    last = await encode(q);
    if (last.size <= target) return last;
  }
  return last;
}
