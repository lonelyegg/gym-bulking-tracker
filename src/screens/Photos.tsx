// Progress photos: take a front / side / back set every ~4 weeks with a faded overlay of last time's
// photo to match the pose, then compare any two dates side by side (default: Day 1 vs latest).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { POSES, type Photo, type Pose } from '../db/schema';
import { weekAverage } from '../lib/body';
import { compressPhoto, loadImage } from '../lib/image';
import { localDate } from '../lib/logic';
import { useBody, weighIns } from '../state/body';
import {
  deletePhotos, lastPhotoOf, photoDates, photoDue, photoOf, POSE_LABEL, savePhoto, usePhotos, usePhotoUrl, type Shot,
} from '../state/photos';
import { photoNote } from '../sync/photos';
import { isConfigured } from '../sync/sync';
import { confirmSheet, go, Header, Segmented, Sheet, toast } from '../components/ui';
import { IconCamera, IconClose } from '../components/icons';

const fmtDate = (d: string, withYear = false) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });

const remember = (k: string, fallback: string) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** A photo thumbnail or full image (downloads from Drive the first time on a new phone). */
export function PhotoImg({ photo, size = 'thumb', onClick, mirror }: { photo: Photo | undefined; size?: 'thumb' | 'full'; onClick?: () => void; mirror?: boolean }) {
  const url = usePhotoUrl(photo, size);
  if (!photo) return <div class="photo-box empty" onClick={onClick}><span>No photo</span></div>;
  return (
    <div class={`photo-box ${onClick ? 'tap' : ''}`} onClick={onClick}>
      {url ? <img src={url} alt={`${POSE_LABEL[photo.pose]} · ${photo.date}`} style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
        : <span class="muted small">{url === undefined ? 'Loading…' : 'Not on this phone'}</span>}
    </div>
  );
}

// ---------- Main screen ----------

export function PhotosScreen() {
  const photos = usePhotos();
  const body = useBody();
  const [pose, setPose] = useState<Pose>(() => remember('photo-pose', 'front') as Pose);
  const dates = photos ? photoDates(photos) : [];
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Photo | null>(null);
  if (!photos) return <div class="page" />;
  const b = before && dates.includes(before) ? before : dates[0];
  const a = after && dates.includes(after) ? after : dates[dates.length - 1];
  const due = photoDue(photos);
  const kgOn = (d: string) => (body ? weekAverage(weighIns(body.weights), d, 1) : null);
  const notBackedUp = photos.filter((p) => !p.drive_file_id).length;

  return (
    <div class="page">
      <Header title="Progress photos" back right={<button class="btn sm primary" onClick={() => go('/photos/capture')}>Take</button>} />
      <p class={`small ${due.due ? 'warn-text' : 'muted'}`}>
        {due.last ? (due.due ? `It’s been 4+ weeks since ${fmtDate(due.last)}: time for a new set.` : `Next set due in ${due.inDays} day${due.inDays === 1 ? '' : 's'} (every 4 weeks).`)
          : 'Take your first set: front, side and back. Same spot, same light, same time of day each time.'}
      </p>

      {dates.length > 0 && (
        <section class="card">
          <Segmented label="Pose" value={POSE_LABEL[pose]} options={POSES.map((p) => POSE_LABEL[p])}
            onChange={(v) => { const p = POSES.find((x) => POSE_LABEL[x] === v)!; setPose(p); store('photo-pose', p); }} />
          <div class="compare">
            {[{ d: b, set: setBefore, label: 'Before' }, { d: a, set: setAfter, label: 'After' }].map(({ d, set, label }) => (
              <div key={label} class="compare-col">
                <PhotoImg photo={photoOf(photos, d, pose)} onClick={() => { const ph = photoOf(photos, d, pose); if (ph) setViewing(ph); }} />
                <select class="date-select" value={d} onChange={(e) => set((e.currentTarget as HTMLSelectElement).value)} aria-label={`${label} date`}>
                  {dates.map((x, i) => <option key={x} value={x}>{i === 0 ? `Day 1 · ${fmtDate(x)}` : fmtDate(x, true)}</option>)}
                </select>
                <div class="muted small center-text">{kgOn(d) != null ? `${kgOn(d)!.toFixed(1)} kg avg` : ' '}</div>
              </div>
            ))}
          </div>
          {dates.length === 1 && <p class="muted small center-text">Your next set will appear here next to this one.</p>}
        </section>
      )}

      {dates.length > 0 && <h3 class="section-title">All photos</h3>}
      {[...dates].reverse().map((d) => (
        <section key={d} class="card photo-set">
          <div class="row between"><span class="bold">{fmtDate(d, true)}{d === dates[0] ? ' · Day 1' : ''}</span>
            {kgOn(d) != null && <span class="muted small">{kgOn(d)!.toFixed(1)} kg</span>}</div>
          <div class="photo-row">
            {POSES.map((p) => {
              const ph = photoOf(photos, d, p);
              return <div key={p}><PhotoImg photo={ph} onClick={ph ? () => setViewing(ph) : undefined} /><div class="muted small center-text">{POSE_LABEL[p]}</div></div>;
            })}
          </div>
        </section>
      ))}

      <p class="fine">Photos stay on this phone{isConfigured() ? ' and in a “Gym Bulking Tracker photos” folder in your Google Drive' : ''}. They’re never shared.
        {!isConfigured() && photos.length > 0 && ' Connect Google Sheets sync (Settings) to back them up to your Drive.'}
        {isConfigured() && notBackedUp > 0 && !photoNote.value && ` ${notBackedUp} waiting to upload.`}
      </p>
      {photoNote.value && <p class="small warn-text">{photoNote.value}</p>}
      <div class="bottom-space" />

      {viewing && (
        <Sheet open onClose={() => setViewing(null)} title={`${POSE_LABEL[viewing.pose]} · ${fmtDate(viewing.date, true)}`}>
          <PhotoImg photo={viewing} size="full" />
          <div class="row gap mt">
            <button class="btn danger-outline" onClick={async () => {
              if (await confirmSheet('Delete this photo? Its Drive copy goes to your Drive bin.', 'Delete', true)) { await deletePhotos([viewing]); setViewing(null); }
            }}>Delete</button>
            <button class="btn grow" onClick={() => setViewing(null)}>Close</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ---------- Capture ----------

type Facing = 'user' | 'environment';
type Taken = Shot & { url: string };

export function CaptureScreen() {
  const photos = usePhotos();
  const [i, setI] = useState(0);
  const [taken, setTaken] = useState<Partial<Record<Pose, Taken>>>({});
  const [review, setReview] = useState<Taken | null>(null);
  const [facing, setFacing] = useState<Facing>(() => remember('cam-facing', 'user') as Facing);
  const [delay, setDelay] = useState(() => Number(remember('cam-timer', '10')));
  const [ghostOn, setGhostOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const pose = POSES[i];
  const ghost = photos ? lastPhotoOf(photos, pose) : undefined;
  const today = localDate();

  useEffect(() => () => { for (const t of Object.values(taken)) if (t) URL.revokeObjectURL(t.url); }, []);

  const accept = (shot: Taken) => {
    setTaken({ ...taken, [shot.pose]: shot });
    setReview(null);
    if (i < POSES.length - 1) setI(i + 1);
  };
  const finish = async () => {
    const list = POSES.map((p) => taken[p]).filter(Boolean) as Taken[];
    if (!list.length) { go('/photos'); return; }
    setSaving(true);
    for (const t of list) await savePhoto(today, t);
    toast(`Saved ${list.length} photo${list.length > 1 ? 's' : ''} ✓`);
    go('/photos');
  };
  const doneCount = POSES.filter((p) => taken[p]).length;

  return (
    <div class="page capture-page">
      <Header title={`${POSE_LABEL[pose]} · ${i + 1} of 3`} back="/photos"
        right={<button class="btn sm primary" disabled={saving || !doneCount} onClick={finish}>{saving ? 'Saving…' : `Save ${doneCount || ''}`}</button>} />
      <div class="pose-steps">
        {POSES.map((p, k) => (
          <button key={p} class={`chip ${k === i ? 'on' : ''}`} onClick={() => { setReview(null); setI(k); }}>{taken[p] ? '✓ ' : ''}{POSE_LABEL[p]}</button>
        ))}
      </div>

      {review ? (
        <div class="review">
          <div class="photo-box big"><img src={review.url} alt="Just taken" /></div>
          <div class="row gap mt">
            <button class="btn grow" onClick={() => { URL.revokeObjectURL(review.url); setReview(null); }}>Retake</button>
            <button class="btn grow primary" onClick={() => accept(review)}>Use photo</button>
          </div>
        </div>
      ) : (
        <Camera key={`${pose}-${facing}`} pose={pose} facing={facing} delay={delay} ghost={ghostOn ? ghost : undefined}
          onShot={(s) => setReview({ ...s, url: URL.createObjectURL(new Blob([s.full], { type: s.mime })) })} />
      )}

      {!review && (
        <div class="cam-controls">
          <Segmented label="Self-timer" value={delay ? `${delay}s` : 'Off'} options={['Off', '3s', '10s']}
            onChange={(v) => { const d = v === 'Off' ? 0 : parseInt(v, 10); setDelay(d); store('cam-timer', String(d)); }} />
          <button class="btn sm" onClick={() => { const f = facing === 'user' ? 'environment' : 'user'; setFacing(f); store('cam-facing', f); }}>
            ⟲ {facing === 'user' ? 'Front' : 'Back'} camera
          </button>
          {ghost && <button class={`btn sm ${ghostOn ? '' : 'ghost'}`} onClick={() => setGhostOn(!ghostOn)}>{ghostOn ? 'Hide' : 'Show'} last photo</button>}
        </div>
      )}
      <p class="fine">{ghost ? `The faded image is your ${POSE_LABEL[pose].toLowerCase()} photo from ${fmtDate(ghost.date)}: line yourself up with it.` : 'Stand side-on for the side photo. Same spot, light and time of day each time makes changes easy to see.'}</p>
      <button class="btn ghost block" onClick={() => setI(Math.min(POSES.length - 1, i + 1))} disabled={i === POSES.length - 1}>Skip this pose</button>
    </div>
  );
}

function Camera(props: { pose: Pose; facing: Facing; delay: number; ghost: Photo | undefined; onShot: (s: Shot) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'starting' | 'live' | 'error'>('starting');
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const mirror = props.facing === 'user';
  const ghostUrl = usePhotoUrl(props.ghost, 'full');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: props.facing, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setState('live');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [props.facing]);

  const capture = async () => {
    const v = video.current;
    if (!v) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    try {
      const c = await compressPhoto(v);
      props.onShot({ pose: props.pose, ...c });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not take the photo');
    }
  };
  const tick = useRef<number | undefined>(undefined);
  useEffect(() => () => clearInterval(tick.current), []);
  const shutter = () => {
    if (count != null) { clearInterval(tick.current); setCount(null); return; } // tap again to cancel the timer
    if (!props.delay) { capture(); return; }
    let n = props.delay;
    setCount(n);
    tick.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(tick.current); setCount(null); capture(); } else setCount(n);
    }, 1000);
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadImage(file);
      const c = await compressPhoto(img);
      props.onShot({ pose: props.pose, ...c });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not use that photo');
    }
  };

  return (
    <div class="camera">
      <div class={`cam-frame ${flash ? 'flash' : ''}`}>
        <video ref={video} playsInline muted autoPlay style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
        {ghostUrl && state === 'live' && <img class="cam-ghost" src={ghostUrl} alt="" style={mirror ? { transform: 'scaleX(-1)' } : undefined} />}
        {state === 'starting' && <div class="cam-msg">Starting camera…</div>}
        {state === 'error' && (
          <div class="cam-msg">
            <div>The camera isn’t available here (or permission was denied).</div>
            {props.ghost && <div class="cam-ref"><PhotoImg photo={props.ghost} /><span class="small muted">Last time</span></div>}
          </div>
        )}
        {count != null && <div class="cam-count">{count}</div>}
        <div class="cam-guide" />
      </div>
      <div class="cam-row">
        <button class="btn sm" onClick={() => fileInput.current?.click()}>From library</button>
        {state === 'live'
          ? <button class="shutter" aria-label={count != null ? 'Cancel timer' : 'Take photo'} onClick={shutter}>{count != null ? <IconClose size={26} /> : ''}</button>
          : <button class="btn primary" onClick={() => fileInput.current?.click()}>Take photo</button>}
        <span />
      </div>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => pick((e.currentTarget as HTMLInputElement).files?.[0])} />
    </div>
  );
}

// ---------- Cards for Body and Home ----------

/** Day 1 vs latest (front), or a prompt to take the first set. */
export function PhotoCompareCard({ title = true }: { title?: boolean }) {
  const photos = usePhotos();
  const dates = useMemo(() => (photos ? photoDates(photos) : []), [photos]);
  if (!photos) return null;
  const due = photoDue(photos);
  const first = dates[0];
  const last = dates[dates.length - 1];
  return (
    <section class="card dash-card tap" onClick={() => go('/photos')}>
      {title && <div class="section-head"><span class="section-head-title" style={{ color: 'var(--c-photo)' }}><IconCamera size={16} />Progress photos</span><span class="section-head-more">{dates.length ? 'Compare' : ''}<span class="chev">›</span></span></div>}
      {!dates.length ? (
        <>
          <p class="empty-note">Photos show changes the scale and tape miss. Take a front, side and back set now, then every 4 weeks.</p>
          <button class="btn tinted block" onClick={(e) => { e.stopPropagation(); go('/photos/capture'); }}><IconCamera size={18} /> Take your first photos</button>
        </>
      ) : (
        <>
          <div class="compare mini">
            <div class="compare-col"><PhotoImg photo={photoOf(photos, first, 'front') ?? photos.find((p) => p.date === first)} /><div class="muted small center-text">Day 1 · {fmtDate(first)}</div></div>
            {last !== first && <div class="compare-col"><PhotoImg photo={photoOf(photos, last, 'front') ?? photos.filter((p) => p.date === last).at(-1)} /><div class="muted small center-text">Latest · {fmtDate(last)}</div></div>}
          </div>
          <p class={`small ${due.due ? 'warn-text' : 'muted'}`}>{due.due ? 'New set due: it’s been 4+ weeks.' : `Next set in ${due.inDays} day${due.inDays === 1 ? '' : 's'}.`}</p>
          {due.due && <button class="btn tinted block" onClick={(e) => { e.stopPropagation(); go('/photos/capture'); }}><IconCamera size={18} /> Take photos</button>}
        </>
      )}
    </section>
  );
}
