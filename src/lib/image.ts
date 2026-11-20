// Image helpers: base64 conversion (pure) and on-phone compression (browser only).

export function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Progress photos are portrait 3:4 so poses line up between dates. */
export const PHOTO_ASPECT = 3 / 4;

/** Centre-crop rectangle of a source so it becomes `aspect` (width / height). */
export function cropRect(w: number, h: number, aspect = PHOTO_ASPECT) {
  if (w / h > aspect) {
    const cw = Math.round(h * aspect);
    return { sx: Math.round((w - cw) / 2), sy: 0, sw: cw, sh: h };
  }
  const ch = Math.round(w / aspect);
  return { sx: 0, sy: Math.round((h - ch) / 2), sw: w, sh: ch };
}

/** Output size that fits within `maxSide`, keeping the aspect. */
export function fitSize(w: number, h: number, maxSide: number) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

type Source = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

function sourceSize(src: Source) {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: src.width, h: src.height };
}

async function encode(src: Source, crop: ReturnType<typeof cropRect>, maxSide: number, quality: number, mirror: boolean) {
  const out = fitSize(crop.sw, crop.sh, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d')!;
  if (mirror) { ctx.translate(out.w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, out.w, out.h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not compress the photo.');
  return { buf: await blob.arrayBuffer(), w: out.w, h: out.h };
}

/**
 * Crop to 3:4 portrait and compress: a full image (≤1600 px, ~250–450 KB) and a thumbnail (≤480 px).
 * `mirror` un-flips a selfie-camera frame so photos are always saved the right way round.
 */
export async function compressPhoto(src: Source, mirror = false) {
  const { w, h } = sourceSize(src);
  if (!w || !h) throw new Error('The camera isn’t ready yet.');
  const crop = cropRect(w, h);
  const full = await encode(src, crop, 1600, 0.82, mirror);
  const thumb = await encode(src, crop, 480, 0.72, mirror);
  return { full: full.buf, thumb: thumb.buf, width: full.w, height: full.h, mime: 'image/jpeg' };
}

/** Load a picked file into an <img> (Safari applies the photo's rotation for us). */
export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that image.')); };
    img.src = url;
  });
}
