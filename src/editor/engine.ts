import type { MediaAsset, Overlay, Track } from "./types";
import { clipDuration, clipEnd } from "./types";

type Entry = {
  el: HTMLVideoElement;
  gain?: GainNode;
  source?: MediaElementAudioSourceNode;
};

/**
 * Playback engine: owns hidden <video> elements, keeps them in sync with the
 * timeline playhead, composites the active frame onto a canvas and applies
 * blur / text overlays. Also exposes a mixed audio stream used for export.
 */
export class Engine {
  private entries = new Map<string, Entry>();
  private host: HTMLDivElement | null = null;
  audioCtx: AudioContext | null = null;
  streamDest: MediaStreamAudioDestinationNode | null = null;
  /** Last successfully drawn video frame, held while a clip is buffering/seeking. */
  private lastFrame: HTMLCanvasElement | null = null;

  private cacheFrame(src: HTMLCanvasElement) {
    let c = this.lastFrame;
    if (!c) {
      c = document.createElement("canvas");
      this.lastFrame = c;
    }
    if (c.width !== src.width || c.height !== src.height) {
      c.width = src.width;
      c.height = src.height;
    }
    const cx = c.getContext("2d");
    if (cx) cx.drawImage(src, 0, 0);
  }

  private ensureHost() {
    if (this.host) return this.host;
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(d);
    this.host = d;
    return d;
  }

  ensureAudio() {
    if (this.audioCtx) return this.audioCtx;
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.audioCtx = ctx;
    this.streamDest = ctx.createMediaStreamDestination();
    for (const [, e] of this.entries) this.wireAudio(e);
    return ctx;
  }

  private wireAudio(e: Entry) {
    if (!this.audioCtx || e.source) return;
    try {
      const source = this.audioCtx.createMediaElementSource(e.el);
      const gain = this.audioCtx.createGain();
      source.connect(gain);
      gain.connect(this.audioCtx.destination);
      if (this.streamDest) gain.connect(this.streamDest);
      e.source = source;
      e.gain = gain;
      e.el.muted = false;
    } catch {
      /* already wired */
    }
  }

  get(asset: MediaAsset): HTMLVideoElement {
    const existing = this.entries.get(asset.id);
    if (existing) return existing.el;
    const el = document.createElement("video");
    el.src = asset.url;
    el.preload = "auto";
    el.playsInline = true;
    el.muted = true;
    this.ensureHost().appendChild(el);
    const entry: Entry = { el };
    this.entries.set(asset.id, entry);
    if (this.audioCtx) this.wireAudio(entry);
    return el;
  }

  release() {
    for (const [, e] of this.entries) {
      e.el.pause();
      e.el.removeAttribute("src");
      e.el.load();
    }
    this.entries.clear();
    this.host?.remove();
    this.host = null;
  }

  /** Clip (top-most visible track wins) active at a given timeline second. */
  activeClip(tracks: Track[], time: number) {
    for (const t of tracks) {
      if (t.hidden) continue;
      const clip = t.clips.find((c) => time >= c.start && time < clipEnd(c) - 0.001);
      if (clip) return { clip, track: t };
    }

    return null;
  }

  duration(tracks: Track[]) {
    let d = 0;
    for (const t of tracks) for (const c of t.clips) d = Math.max(d, clipEnd(c));
    return d;
  }

  /** Next clip starting shortly after `time` (used to pre-roll and avoid black frames). */
  private upcomingClip(tracks: Track[], time: number, lookahead = 1.5) {
    let best: { clip: Track["clips"][number]; track: Track } | null = null;
    for (const t of tracks) {
      if (t.hidden) continue;
      for (const c of t.clips) {
        if (c.start > time && c.start <= time + lookahead) {
          if (!best || c.start < best.clip.start) best = { clip: c, track: t };
        }
      }
    }
    return best;
  }

  /**
   * Sync every media element to the playhead.
   * Returns the timeline time derived from the active video element's own clock
   * (media clock) so playback never repeats or skips a second.
   */
  sync(tracks: Track[], media: MediaAsset[], time: number, playing: boolean): number {
    const active = this.activeClip(tracks, time);
    const upcoming = this.upcomingClip(tracks, time);
    const byId = new Map(media.map((m) => [m.id, m]));

    for (const m of media) {
      const entry = this.entries.get(m.id);
      if (!entry) continue;
      const isActive = active?.clip.mediaId === m.id;
      if (!isActive && !entry.el.paused) entry.el.pause();
      const g = entry.gain;
      if (g && !isActive) g.gain.value = 0;
      else if (!g && !isActive) entry.el.muted = true;
    }

    // Pre-roll the next clip so its first frame is decoded before it appears.
    if (upcoming && upcoming.clip.mediaId !== active?.clip.mediaId) {
      const nextAsset = byId.get(upcoming.clip.mediaId);
      if (nextAsset) {
        const nextEl = this.get(nextAsset);
        if (nextEl.readyState < 2 || Math.abs(nextEl.currentTime - upcoming.clip.in) > 0.5) {
          try {
            nextEl.currentTime = Math.min(Math.max(upcoming.clip.in, 0), Math.max(nextAsset.duration - 0.05, 0));
          } catch {
            /* ignore */
          }
        }
      }
    }

    if (!active) return time;
    const asset = byId.get(active.clip.mediaId);
    if (!asset) return time;
    const el = this.get(asset);
    const target = active.clip.in + (time - active.clip.start);
    const drift = el.currentTime - target;
    // While playing the element owns the clock; only correct on a real desync.
    const tolerance = playing ? 0.35 : 0.04;
    if (Math.abs(drift) > tolerance && !el.seeking) {
      try {
        el.currentTime = Math.min(Math.max(target, 0), Math.max(asset.duration - 0.05, 0));
      } catch {
        /* ignore */
      }
    }
    const audible = !active.clip.muted && !active.track?.muted;
    const vol = audible ? active.clip.volume : 0;
    const entry = this.entries.get(asset.id)!;
    if (entry.gain) entry.gain.gain.value = vol;
    else el.muted = !audible;
    el.volume = entry.gain ? 1 : vol;

    if (playing && el.paused) void el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();

    // Media clock: keeps the playhead locked to actual decoded playback.
    if (playing && !el.seeking && el.readyState >= 2) {
      const mediaTime = active.clip.start + (el.currentTime - active.clip.in);
      if (mediaTime >= active.clip.start && mediaTime <= clipEnd(active.clip) && Math.abs(mediaTime - time) < 0.5) {
        return mediaTime;
      }
    }
    return time;
  }

  render(
    ctx: CanvasRenderingContext2D,
    tracks: Track[],
    media: MediaAsset[],
    overlays: Overlay[],
    time: number,
  ) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.save();
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const active = this.activeClip(tracks, time);
    if (active) {
      const asset = media.find((m) => m.id === active.clip.mediaId);
      const el = asset ? this.entries.get(asset.id)?.el : undefined;
      const ready = !!el && el.readyState >= 2 && el.videoWidth > 0;
      if (!ready) {
        // Element is still seeking/buffering: hold the previous good frame
        // instead of flashing black.
        const hold = this.lastFrame;
        if (hold && hold.width > 0) ctx.drawImage(hold, 0, 0, W, H);
      }
      if (el && ready) {
        const vw = el.videoWidth || 16;
        const vh = el.videoHeight || 9;
        const cropLeft = Math.max(0, Math.min((active.clip.cropLeft ?? 0), 0.5));
        const cropRight = Math.max(0, Math.min((active.clip.cropRight ?? 0), 0.5));
        const cropTop = Math.max(0, Math.min((active.clip.cropTop ?? 0), 0.5));
        const cropBottom = Math.max(0, Math.min((active.clip.cropBottom ?? 0), 0.5));
        const cropW = Math.max(0.05, 1 - cropLeft - cropRight);
        const cropH = Math.max(0.05, 1 - cropTop - cropBottom);
        const srcX = vw * cropLeft;
        const srcY = vh * cropTop;
        const srcW = vw * cropW;
        const srcH = vh * cropH;
        const scale = Math.min(W / srcW, H / srcH);
        const dw = srcW * scale;
        const dh = srcH * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.drawImage(el, srcX, srcY, srcW, srcH, dx, dy, dw, dh);
        this.cacheFrame(ctx.canvas);

        for (const ov of overlays) {
          if (ov.type !== "blur" || time < ov.start || time > ov.end) continue;
          const rx = ov.x * W;
          const ry = ov.y * H;
          const rw = ov.w * W;
          const rh = ov.h * H;
          ctx.save();
          ctx.beginPath();
          ctx.rect(rx, ry, rw, rh);
          ctx.clip();
          ctx.filter = `blur(${Math.max(1, ov.amount)}px)`;
          ctx.drawImage(el, srcX, srcY, srcW, srcH, dx, dy, dw, dh);
          ctx.restore();
        }
      }
    }

    ctx.filter = "none";
    for (const ov of overlays) {
      if (ov.type !== "text" || time < ov.start || time > ov.end) continue;
      const rx = ov.x * W;
      const ry = ov.y * H;
      const rw = ov.w * W;
      const rh = ov.h * H;
      const size = (ov.size / 1080) * H;
      if (ov.bg && ov.bg !== "transparent") {
        ctx.fillStyle = ov.bg;
        ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.fillStyle = ov.color;
      ctx.font = `600 ${size}px Inter, Segoe UI, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = ov.align;
      const tx = ov.align === "left" ? rx + size * 0.25 : ov.align === "right" ? rx + rw - size * 0.25 : rx + rw / 2;
      const lines = ov.text.split("\n");
      lines.forEach((line, i) => {
        const ly = ry + rh / 2 + (i - (lines.length - 1) / 2) * size * 1.2;
        ctx.fillText(line, tx, ly);
      });
    }
    ctx.restore();
  }
}

export const engine = new Engine();
export { clipDuration, clipEnd };
