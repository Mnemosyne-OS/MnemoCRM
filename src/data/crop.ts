/**
 * Cut a product's picture out of a rendered catalogue page, in the frame.
 * The page arrives as a JPEG from the host renderer; the box comes from the
 * model (fractions of the page). A small margin keeps a box that is a little
 * tight from shaving the piece.
 */
import type { Box } from '../model/pdfCatalog';

const MARGIN = 0.01;

/** Pixel rectangle for a box on a w×h page, margin included, clamped to the page. */
export function boxToPixels(box: Box, w: number, h: number): { x: number; y: number; width: number; height: number } {
  const l = Math.max(0, box[0] - MARGIN) * w;
  const t = Math.max(0, box[1] - MARGIN) * h;
  const r = Math.min(1, box[2] + MARGIN) * w;
  const b = Math.min(1, box[3] + MARGIN) * h;
  return { x: Math.round(l), y: Math.round(t), width: Math.max(1, Math.round(r - l)), height: Math.max(1, Math.round(b - t)) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => reject(new Error('IMAGE_TIMEOUT')), 15_000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('IMAGE_UNREADABLE'));
    };
    img.src = src;
  });
}

/** Resolves the crop as a JPEG, base64 without prefix. */
export async function cropJpeg(pageJpegBase64: string, box: Box): Promise<string> {
  const img = await loadImage(`data:image/jpeg;base64,${pageJpegBase64}`);
  const px = boxToPixels(box, img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('NO_CANVAS');
  ctx.drawImage(img, px.x, px.y, px.width, px.height, 0, 0, px.width, px.height);
  const url = canvas.toDataURL('image/jpeg', 0.88);
  return url.slice(url.indexOf(',') + 1);
}
