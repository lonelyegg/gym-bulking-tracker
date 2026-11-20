// Progress photo backup to the Drive folder your Apps Script manages.
import { signal } from '@preact/signals';
import { db, patch } from '../db/db';
import type { Photo } from '../db/schema';
import { base64ToBytes, bytesToBase64 } from '../lib/image';
import { callApi, SyncError } from './sync';

/** A note for Settings when photos can't be backed up (e.g. the script needs updating). */
export const photoNote = signal<string | null>(null);

const OUTDATED = 'Your Apps Script doesn’t back up photos yet. Paste the latest Code.gs, run setup once (it asks for Drive access), then Deploy → Manage deployments → Edit → New version.';

const isOutdated = (e: unknown) => e instanceof SyncError && /unknown action/.test(e.message);

/** Upload photos that aren't in Drive yet, and move deleted photos' copies to the Drive bin. */
export async function syncPhotos(cfg: { url: string; token: string }): Promise<{ uploaded: number; trashed: number }> {
  const all = await db.photos.toArray();
  let uploaded = 0;
  let trashed = 0;
  try {
    for (const p of all.filter((x) => x.deleted && x.drive_file_id)) {
      await callApi(cfg, 'photo_delete', { file_id: p.drive_file_id });
      await patch('photos', p.id, { drive_file_id: null });
      trashed++;
    }
    for (const p of all.filter((x) => !x.deleted && !x.drive_file_id)) {
      const blob = await db.photo_blobs.get(p.id);
      if (!blob) continue;
      const res = await callApi(cfg, 'photo_upload', {
        id: p.id, name: `${p.date} ${p.pose} ${p.id}.jpg`, mime: blob.mime, data: bytesToBase64(blob.full),
      });
      await patch('photos', p.id, { drive_file_id: String(res.file_id) });
      uploaded++;
    }
    photoNote.value = null;
  } catch (e) {
    if (isOutdated(e)) { photoNote.value = OUTDATED; return { uploaded, trashed }; }
    throw e;
  }
  return { uploaded, trashed };
}

/** Download a photo's image from Drive (used on a new phone). */
export async function fetchPhoto(cfg: { url: string; token: string }, photo: Photo): Promise<ArrayBuffer | null> {
  if (!photo.drive_file_id) return null;
  try {
    const res = await callApi(cfg, 'photo_get', { file_id: photo.drive_file_id });
    return typeof res.data === 'string' ? base64ToBytes(res.data) : null;
  } catch (e) {
    if (isOutdated(e)) photoNote.value = OUTDATED;
    return null;
  }
}
