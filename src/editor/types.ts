export type MediaAsset = {
  id: string;
  name: string;
  url: string;
  duration: number;
  width: number;
  height: number;
  thumbnail?: string | undefined;
};

export type Clip = {
  id: string;
  mediaId: string;
  name: string;
  /** position on the timeline, seconds */
  start: number;
  /** trim in/out inside the source media, seconds */
  in: number;
  out: number;
  muted: boolean;
  volume: number;
  cropLeft: number;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
};

export type Track = {
  id: string;
  name: string;
  muted: boolean;
  hidden: boolean;
  clips: Clip[];
};

export type TextOverlay = {
  id: string;
  type: "text";
  text: string;
  start: number;
  end: number;
  x: number; // 0..1
  y: number; // 0..1
  w: number;
  h: number;
  size: number; // px at 1080p
  color: string;
  bg: string;
  bgEnabled: boolean;
  align: "left" | "center" | "right";
};

export type BlurOverlay = {
  id: string;
  type: "blur";
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
  amount: number;
};

export type Overlay = TextOverlay | BlurOverlay;

export type ExportSettings = {
  container: "webm" | "mp4";
  fps: number;
  width: number;
  height: number;
  bitrateMbps: number;
};

export const clipDuration = (c: Clip) => Math.max(0.05, c.out - c.in);
export const clipEnd = (c: Clip) => c.start + clipDuration(c);

/**
 * Finds the nearest start position on a track where a clip of `dur` seconds fits
 * without overlapping any existing clip (clip `ignoreId` is excluded).
 */
export const resolveStart = (clips: Clip[], desired: number, dur: number, ignoreId?: string) => {
  const others = clips
    .filter((c) => c.id !== ignoreId)
    .sort((a, b) => a.start - b.start);
  const want = Math.max(0, desired);
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const c of others) {
    if (c.start - cursor > 0.01) gaps.push([cursor, c.start]);
    cursor = Math.max(cursor, clipEnd(c));
  }
  gaps.push([cursor, Infinity]);
  let best = cursor;
  let bestDist = Infinity;
  for (const [gs, ge] of gaps) {
    if (ge - gs < dur - 0.01) continue;
    // The final open-ended gap must still clamp to its beginning. Using
    // `want` as the upper bound here allowed clips to land inside an earlier
    // occupied interval whenever no finite gap was large enough.
    const cand = ge === Infinity ? Math.max(want, gs) : Math.min(Math.max(want, gs), ge - dur);
    const d = Math.abs(cand - want);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return Math.max(0, best);
};

export const fmt = (t: number) => {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
};

export const uid = () => Math.random().toString(36).slice(2, 10);
