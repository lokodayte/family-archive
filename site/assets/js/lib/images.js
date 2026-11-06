// Resizing photos in the browser before upload.
// Every image is re-drawn, which also removes hidden data such as GPS location.
import {
  fitWithin, encodeToTarget, FULL_MAX, DOC_MAX, THUMB_MAX, FULL_TARGET, DOC_TARGET, THUMB_TARGET,
} from './imageMath.js';

export const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,.heic,.heif';

export class UnsupportedImageError extends Error {
  constructor(name) {
    super(`“${name}” can’t be read by this browser. Save it as a JPEG first (for iPhone photos: share it to yourself as “Most Compatible”), then try again.`);
    this.name = 'UnsupportedImageError';
  }
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers only decode certain formats through <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new UnsupportedImageError(file.name || 'This file');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const sizeOf = (src) => ({ w: src.naturalWidth || src.width, h: src.naturalHeight || src.height });

function draw(src, w, h, rotate = 0) {
  const canvas = document.createElement('canvas');
  const turned = rotate % 180 !== 0;
  canvas.width = turned ? h : w;
  canvas.height = turned ? w : h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  return canvas;
}

const toJpeg = (canvas) => (q) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress the image'))), 'image/jpeg', q);
});

async function render(src, max, target, rotate) {
  const { w: ow, h: oh } = sizeOf(src);
  let { w, h } = fitWithin(ow, oh, max);
  let blob;
  // If even low quality is too big, shrink a little and try again.
  for (let i = 0; i < 4; i++) {
    const canvas = draw(src, w, h, rotate);
    blob = await encodeToTarget(toJpeg(canvas), target);
    if (blob.size <= target * 1.15) break;
    w = Math.round(w * 0.85);
    h = Math.round(h * 0.85);
  }
  const turned = rotate % 180 !== 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: turned ? h : w, h: turned ? w : h };
}

/**
 * Turn a chosen file into a web-sized image and a thumbnail.
 * kind: 'photo' | 'document'; rotate: 0/90/180/270 degrees clockwise
 */
export async function processImage(fileOrBlob, { kind = 'photo', rotate = 0 } = {}) {
  const src = await decode(fileOrBlob);
  const doc = kind === 'document';
  const full = await render(src, doc ? DOC_MAX : FULL_MAX, doc ? DOC_TARGET : FULL_TARGET, rotate);
  const thumb = await render(src, THUMB_MAX, THUMB_TARGET, rotate);
  src.close?.();
  return { image: full.bytes, thumb: thumb.bytes, w: full.w, h: full.h };
}

/** Rotate an already processed JPEG (bytes) by 90° steps. */
export function rotateImage(bytes, degrees, kind) {
  return processImage(new Blob([bytes], { type: 'image/jpeg' }), { kind, rotate: ((degrees % 360) + 360) % 360 });
}

export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
