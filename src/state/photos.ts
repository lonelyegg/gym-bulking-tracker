// Progress photos: one set (front / side / back) every ~4 weeks. The image lives on this phone;
// a copy goes to your Google Drive folder when sync is on. Metadata syncs like everything else.
import { useEffect, useState } from 'preact/hooks';
import { db, put, softDelete, useLive } from '../db/db';
import type { Photo, Pose } from '../db/schema';
import { daysBetween, localDate } from '../lib/logic';

export const PHOTO_EVERY_DAYS = 28;
export const POSE_LABEL: Record<Pose, string> = { front: 'Front', side: 'Side', back: 'Back' };

export const usePhotos = () => useLive(async () => (await db.photos.toArray()).filter((p) => !p.deleted)
  .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)), []);

/** Dates that have photos, oldest first. */
export const photoDates = (photos: Photo[]) => [...new Set(photos.map((p) => p.date))].sort();

/** The photo of a pose on a date (latest taken if there are several). */
export const photoOf = (photos: Photo[], date: string, pose: Pose) =>
  photos.filter((p) => p.date === date && p.pose === pose).at(-1);

/** Most recent photo of a pose before (or on) a date, for the ghost overlay. */
export const lastPhotoOf = (photos: Photo[], pose: Pose, before = '9999') =>
  photos.filter((p) => p.pose === pose && p.date <= before).at(-1);

/** Every 4 weeks: when the next set is due. */
export function photoDue(photos: Photo[], today = localDate()): { due: boolean; inDays: number; last: string | null } {
  const last = photoDates(photos).at(-1) ?? null;
  if (!last) return { due: true, inDays: 0, last };
  const since = daysBetween(last, today);
  return { due: since >= PHOTO_EVERY_DAYS, inDays: Math.max(0, PHOTO_EVERY_DAYS - since), last };
}

export interface Shot { pose: Pose; full: ArrayBuffer; thumb: ArrayBuffer; width: number; height: number; mime: string }

/** Save one photo: metadata (synced) + image (local). Taking a pose again the same day replaces it. */
export async function savePhoto(date: string, shot: Shot): Promise<Photo> {
  const existing = (await db.photos.where('date').equals(date).toArray()).filter((p) => !p.deleted && p.pose === shot.pose);
  if (existing.length) await deletePhotos(existing);
  const [photo] = await put('photos', { date, pose: shot.pose, drive_file_id: null, width: shot.width, height: shot.height });
  await db.photo_blobs.put({ id: photo.id, full: shot.full, thumb: shot.thumb, mime: shot.mime });
  return photo;
}

/** Delete photos here; their Drive copies are moved to the Drive bin on the next sync. */
export async function deletePhotos(photos: Photo[]) {
  await softDelete('photos', photos.map((p) => p.id));
  await db.photo_blobs.bulkDelete(photos.map((p) => p.id));
}

// ---------- Showing images ----------

const urlCache = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();
/** Set by sync: fetches an image from Drive when it isn't on this phone yet. */
let remoteFetch: ((photo: Photo) => Promise<ArrayBuffer | null>) | null = null;
export const setRemotePhotoFetch = (fn: typeof remoteFetch) => { remoteFetch = fn; };

async function loadUrl(photo: Photo, size: 'full' | 'thumb'): Promise<string | null> {
  const key = `${photo.id}:${size}`;
  if (urlCache.has(key)) return urlCache.get(key)!;
  let blob = await db.photo_blobs.get(photo.id);
  if (!blob && photo.drive_file_id && remoteFetch) {
    const buf = await remoteFetch(photo).catch(() => null);
    if (buf) {
      blob = { id: photo.id, full: buf, thumb: buf, mime: 'image/jpeg' };
      await db.photo_blobs.put(blob);
    }
  }
  if (!blob) return null;
  const url = URL.createObjectURL(new Blob([size === 'full' ? blob.full : blob.thumb], { type: blob.mime }));
  urlCache.set(key, url);
  return url;
}

/** Object URL for a photo (downloads it from Drive the first time on a new phone). undefined = loading, null = unavailable. */
export function usePhotoUrl(photo: Photo | undefined, size: 'full' | 'thumb' = 'thumb'): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(photo ? urlCache.get(`${photo.id}:${size}`) : null);
  useEffect(() => {
    if (!photo) { setUrl(null); return; }
    const key = `${photo.id}:${size}`;
    if (urlCache.has(key)) { setUrl(urlCache.get(key)); return; }
    setUrl(undefined);
    let alive = true;
    const p = loading.get(key) ?? loadUrl(photo, size).finally(() => loading.delete(key));
    loading.set(key, p);
    p.then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [photo?.id, photo?.drive_file_id, size]);
  return url;
}
