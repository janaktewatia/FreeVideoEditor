import type { Clip, MediaAsset, Overlay, Track } from "./types";
import { clipDuration, clipEnd } from "./types";

type Entry = {
  kind: MediaAsset["kind"];
  mediaEl?: HTMLMediaElement;
  image?: HTMLImageElement;
  gain?: GainNode;
  source?: MediaElementAudioSourceNode;
};

/**
 * Playback engine: owns hidden media elements, keeps them in sync with the
 * timeline playhead, composites visual clips onto a canvas and applies
 * transitions/overlays. Also exposes a mixed audio stream used for export.
 */
export class Engine {
  private entries = new Map<string, Entry>();
  private host: HTMLDivElement | null = null;
  audioCtx: AudioContext | null = null;
  streamDest: MediaStreamAudioDestinationNode | null = null;
  /** Last successfully drawn visual frame, held while buffering/seeking. */
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
    if (!this.audioCtx || e.source || !e.mediaEl) return;
    try {
      const source = this.audioCtx.createMediaElementSource(e.mediaEl);
      const gain = this.audioCtx.createGain();
      source.connect(gain);
      gain.connect(this.audioCtx.destination);
      if (this.streamDest) gain.connect(this.streamDest);
      e.source = source;
      e.gain = gain;
      e.mediaEl.muted = false;
    } catch {
      /* already wired */
    }
  }

  private createEntry(asset: MediaAsset): Entry {
    if (asset.kind === "image") {
      const image = new Image();
      image.src = asset.url;
      return { kind: "image", image };
    }

    const el = document.createElement(asset.kind === "audio" ? "audio" : "video");
    el.src = asset.url;
    el.preload = "auto";
    el.playsInline = true;
    el.muted = true;
    this.ensureHost().appendChild(el);
    return { kind: asset.kind, mediaEl: el };
  }

  get(asset: MediaAsset): HTMLMediaElement | HTMLImageElement {
    const existing = this.entries.get(asset.id);
    if (existing) return existing.image ?? (existing.mediaEl as HTMLMediaElement);
    const entry = this.createEntry(asset);
    this.entries.set(asset.id, entry);
    if (this.audioCtx) this.wireAudio(entry);
    return entry.image ?? (entry.mediaEl as HTMLMediaElement);
  }

  private getEntry(asset: MediaAsset): Entry {
    const existing = this.entries.get(asset.id);
    if (existing) return existing;
    this.get(asset);
    return this.entries.get(asset.id)!;
  }

  release() {
    for (const [, e] of this.entries) {
      if (e.mediaEl) {
        e.mediaEl.pause();
        e.mediaEl.removeAttribute("src");
        e.mediaEl.load();
      }
    }
    this.entries.clear();
    this.host?.remove();
    this.host = null;
  }

  /** Visual clip (video/image) active at a given timeline second. */
  activeVisualClip(tracks: Track[], media: MediaAsset[], time: number) {
    const byId = new Map(media.map((m) => [m.id, m]));
    for (const t of tracks) {
      if (t.hidden) continue;
      const clip = t.clips.find((c) => time >= c.start && time < clipEnd(c) - 0.001);
      if (!clip) continue;
      const asset = byId.get(clip.mediaId);
      if (asset && asset.kind !== "audio") return { clip, track: t, asset };
    }
    return null;
  }

  duration(tracks: Track[]) {
    let d = 0;
    for (const t of tracks) for (const c of t.clips) d = Math.max(d, clipEnd(c));
    return d;
  }

  /** Next visual clip starting shortly after `time` (used for pre-roll). */
  private upcomingVisualClip(tracks: Track[], media: MediaAsset[], time: number, lookahead = 1.5) {
    const byId = new Map(media.map((m) => [m.id, m]));
    let best: { clip: Track["clips"][number]; track: Track; asset: MediaAsset } | null = null;
    for (const t of tracks) {
      if (t.hidden) continue;
      for (const c of t.clips) {
        if (c.start > time && c.start <= time + lookahead) {
          const asset = byId.get(c.mediaId);
          if (!asset || asset.kind === "audio") continue;
          if (!best || c.start < best.clip.start) best = { clip: c, track: t, asset };
        }
      }
    }
    return best;
  }

  private activeAudibleClips(tracks: Track[], media: MediaAsset[], time: number) {
    const byId = new Map(media.map((m) => [m.id, m]));
    const out: Array<{ clip: Clip; asset: MediaAsset }> = [];
    for (const t of tracks) {
      if (t.muted) continue;
      for (const c of t.clips) {
        if (time < c.start || time >= clipEnd(c) - 0.001) continue;
        if (c.muted || c.volume <= 0) continue;
        const asset = byId.get(c.mediaId);
        if (!asset || asset.kind === "image") continue;
        out.push({ clip: c, asset });
      }
    }
    return out;
  }

  /**
   * Sync every media element to the playhead.
   * Returns timeline time derived from the active visual media clock.
   */
  sync(tracks: Track[], media: MediaAsset[], overlays: Overlay[], time: number, playing: boolean): number {
    const activeVisual = this.activeVisualClip(tracks, media, time);
    const upcomingVisual = this.upcomingVisualClip(tracks, media, time);
    const audible = this.activeAudibleClips(tracks, media, time);

    const keepPlaying = new Set<string>(audible.map((a) => a.asset.id));
    const byId = new Map(media.map((m) => [m.id, m]));
    const activePip = overlays.filter((o) => o.type === "media" && time >= o.start && time <= o.end);
    for (const ov of activePip) {
      const asset = byId.get(ov.mediaId);
      if (asset && asset.kind === "video") keepPlaying.add(asset.id);
    }
    if (activeVisual?.asset.kind === "video") keepPlaying.add(activeVisual.asset.id);

    if (upcomingVisual && upcomingVisual.asset.kind === "video" && upcomingVisual.asset.id !== activeVisual?.asset.id) {
      const next = this.getEntry(upcomingVisual.asset).mediaEl as HTMLVideoElement;
      if (next.readyState < 2 || Math.abs(next.currentTime - upcomingVisual.clip.in) > 0.5) {
        try {
          next.currentTime = Math.min(
            Math.max(upcomingVisual.clip.in, 0),
            Math.max(upcomingVisual.asset.duration - 0.05, 0),
          );
        } catch {
          /* ignore */
        }
      }
    }

    for (const m of media) {
      const entry = this.entries.get(m.id);
      const el = entry?.mediaEl;
      if (!entry || !el) continue;
      const needed = keepPlaying.has(m.id);
      if (!needed && !el.paused) el.pause();
      if (!needed) {
        if (entry.gain) entry.gain.gain.value = 0;
        else el.muted = true;
      }
    }

    for (const a of audible) {
      const entry = this.getEntry(a.asset);
      const el = entry.mediaEl;
      if (!el) continue;
      const target = a.clip.in + (time - a.clip.start);
      const drift = el.currentTime - target;
      const tolerance = playing ? 0.35 : 0.04;
      if (Math.abs(drift) > tolerance && !el.seeking) {
        try {
          el.currentTime = Math.min(Math.max(target, 0), Math.max(a.asset.duration - 0.05, 0));
        } catch {
          /* ignore */
        }
      }
      if (entry.gain) entry.gain.gain.value = a.clip.volume;
      else {
        el.muted = false;
        el.volume = a.clip.volume;
      }
      if (playing && el.paused) void el.play().catch(() => {});
      if (!playing && !el.paused) el.pause();
    }

    for (const ov of activePip) {
      const asset = byId.get(ov.mediaId);
      if (!asset || asset.kind !== "video") continue;
      const entry = this.getEntry(asset);
      const el = entry.mediaEl as HTMLVideoElement | undefined;
      if (!el) continue;
      const target = Math.max(0, time - ov.start);
      const drift = el.currentTime - target;
      if (Math.abs(drift) > (playing ? 0.35 : 0.04) && !el.seeking) {
        try {
          el.currentTime = Math.min(Math.max(target, 0), Math.max(asset.duration - 0.05, 0));
        } catch {
          /* ignore */
        }
      }
      if (entry.gain) entry.gain.gain.value = 0;
      el.muted = true;
      el.volume = 0;
      if (playing && el.paused) void el.play().catch(() => {});
      if (!playing && !el.paused) el.pause();
    }

    if (!activeVisual || activeVisual.asset.kind !== "video") return time;
    const vEntry = this.getEntry(activeVisual.asset);
    const videoEl = vEntry.mediaEl as HTMLVideoElement | undefined;
    if (!videoEl) return time;

    const target = activeVisual.clip.in + (time - activeVisual.clip.start);
    const drift = videoEl.currentTime - target;
    const tolerance = playing ? 0.35 : 0.04;
    if (Math.abs(drift) > tolerance && !videoEl.seeking) {
      try {
        videoEl.currentTime = Math.min(Math.max(target, 0), Math.max(activeVisual.asset.duration - 0.05, 0));
      } catch {
        /* ignore */
      }
    }

    const audibleVideo = audible.some((a) => a.asset.id === activeVisual.asset.id);
    if (!audibleVideo) {
      if (vEntry.gain) vEntry.gain.gain.value = 0;
      else {
        videoEl.muted = true;
        videoEl.volume = 0;
      }
      if (playing && videoEl.paused) void videoEl.play().catch(() => {});
      if (!playing && !videoEl.paused) videoEl.pause();
    }

    if (playing && !videoEl.seeking && videoEl.readyState >= 2) {
      const mediaTime = activeVisual.clip.start + (videoEl.currentTime - activeVisual.clip.in);
      if (
        mediaTime >= activeVisual.clip.start &&
        mediaTime <= clipEnd(activeVisual.clip) &&
        Math.abs(mediaTime - time) < 0.5
      ) {
        return mediaTime;
      }
    }

    return time;
  }

  private drawVisualClip(ctx: CanvasRenderingContext2D, clip: Clip, asset: MediaAsset, time: number) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    const cropLeft = Math.max(0, Math.min(clip.cropLeft ?? 0, 0.5));
    const cropRight = Math.max(0, Math.min(clip.cropRight ?? 0, 0.5));
    const cropTop = Math.max(0, Math.min(clip.cropTop ?? 0, 0.5));
    const cropBottom = Math.max(0, Math.min(clip.cropBottom ?? 0, 0.5));
    const cropW = Math.max(0.05, 1 - cropLeft - cropRight);
    const cropH = Math.max(0.05, 1 - cropTop - cropBottom);

    let srcW = 16;
    let srcH = 9;
    let src: CanvasImageSource | null = null;

    if (asset.kind === "image") {
      const img = this.getEntry(asset).image;
      if (!img || !img.complete || !img.naturalWidth) return false;
      src = img;
      srcW = img.naturalWidth;
      srcH = img.naturalHeight;
    } else if (asset.kind === "video") {
      const el = this.getEntry(asset).mediaEl as HTMLVideoElement | undefined;
      const ready = !!el && el.readyState >= 2 && el.videoWidth > 0;
      if (!ready || !el) return false;
      src = el;
      srcW = el.videoWidth || 16;
      srcH = el.videoHeight || 9;
    } else {
      return false;
    }

    const sx = srcW * cropLeft;
    const sy = srcH * cropTop;
    const sw = srcW * cropW;
    const sh = srcH * cropH;
    const scale = Math.min(W / sw, H / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    const introDur = Math.max(0, clip.transitionDuration || 0);
    const introP = introDur > 0 ? Math.min(1, Math.max(0, (time - clip.start) / introDur)) : 1;

    ctx.save();
    if (clip.transition === "fade" && introDur > 0) {
      ctx.globalAlpha *= introP;
    } else if (clip.transition === "slide" && introDur > 0) {
      ctx.translate((1 - introP) * W * 0.08, 0);
    } else if (clip.transition === "zoom" && introDur > 0) {
      const s = 1.12 - 0.12 * introP;
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
    return true;
  }

  private applyZoom(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
    mode: "focus" | "center",
  ) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    const rx = x * W;
    const ry = y * H;
    const rw = Math.max(2, w * W);
    const rh = Math.max(2, h * H);
    const fx = mode === "center" ? W * 0.5 : rx + rw * 0.5;
    const fy = mode === "center" ? H * 0.5 : ry + rh * 0.5;

    const snapshot = document.createElement("canvas");
    snapshot.width = W;
    snapshot.height = H;
    const sx = snapshot.getContext("2d");
    if (!sx) return;
    sx.drawImage(ctx.canvas, 0, 0);

    const z = Math.max(1, scale);
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(z, z);
    ctx.translate(-fx, -fy);
    ctx.drawImage(snapshot, 0, 0, W, H);
    ctx.restore();
  }

  private easeMix01(t: number, smoothness: number) {
    const clamped = Math.max(0, Math.min(1, t));
    const smooth = clamped * clamped * (3 - 2 * clamped);
    const softer = smooth * smooth * (3 - 2 * smooth);
    const s = Math.max(0, Math.min(1, smoothness));
    return clamped * (1 - s) + softer * s;
  }

  private smoothZoomScale(
    start: number,
    end: number,
    targetScale: number,
    time: number,
    smoothness: number,
    zoomInDuration: number,
    zoomOutDuration: number,
  ) {
    const dur = Math.max(0.01, end - start);
    const p = Math.max(0, Math.min(1, (time - start) / dur));
    let zinSec = Math.max(0.05, Math.min(dur - 0.05, zoomInDuration));
    let zoutSec = Math.max(0.05, Math.min(dur - 0.05, zoomOutDuration));
    if (zinSec + zoutSec > dur - 0.05) {
      const scale = (dur - 0.05) / (zinSec + zoutSec);
      zinSec *= scale;
      zoutSec *= scale;
    }
    const holdStart = zinSec / dur;
    const holdEnd = Math.max(holdStart, (dur - zoutSec) / dur);

    let intensity = 0;
    if (p <= holdStart) {
      intensity = this.easeMix01(p / Math.max(0.001, holdStart), smoothness);
    } else if (p < holdEnd) {
      intensity = 1;
    } else {
      intensity = 1 - this.easeMix01((p - holdEnd) / Math.max(0.001, 1 - holdEnd), smoothness);
    }
    return 1 + (Math.max(1, targetScale) - 1) * intensity;
  }

  private drawPipMedia(ctx: CanvasRenderingContext2D, asset: MediaAsset, x: number, y: number, w: number, h: number, opacity: number, borderRadius: number) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const rx = x * W;
    const ry = y * H;
    const rw = w * W;
    const rh = h * H;

    let src: CanvasImageSource | null = null;
    let sw = 16;
    let sh = 9;
    if (asset.kind === "image") {
      const img = this.getEntry(asset).image;
      if (!img || !img.complete || !img.naturalWidth) return;
      src = img;
      sw = img.naturalWidth;
      sh = img.naturalHeight;
    } else if (asset.kind === "video") {
      const el = this.getEntry(asset).mediaEl as HTMLVideoElement | undefined;
      if (!el || el.readyState < 2 || el.videoWidth < 1) return;
      src = el;
      sw = el.videoWidth;
      sh = el.videoHeight;
    }
    if (!src) return;

    const fit = Math.min(rw / sw, rh / sh);
    const dw = sw * fit;
    const dh = sh * fit;
    const dx = rx + (rw - dw) / 2;
    const dy = ry + (rh - dh) / 2;
    const r = Math.max(0, borderRadius);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
    ctx.beginPath();
    ctx.moveTo(rx + r, ry);
    ctx.lineTo(rx + rw - r, ry);
    ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
    ctx.lineTo(rx + rw, ry + rh - r);
    ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
    ctx.lineTo(rx + r, ry + rh);
    ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
    ctx.lineTo(rx, ry + r);
    ctx.quadraticCurveTo(rx, ry, rx + r, ry);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(rx, ry, rw, rh);
    ctx.drawImage(src, dx, dy, dw, dh);
    ctx.restore();
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

    const active = this.activeVisualClip(tracks, media, time);
    if (active) {
      const ok = this.drawVisualClip(ctx, active.clip, active.asset, time);
      if (!ok) {
        const hold = this.lastFrame;
        if (hold && hold.width > 0) ctx.drawImage(hold, 0, 0, W, H);
      } else {
        this.cacheFrame(ctx.canvas);
      }
    }

    for (const ov of overlays) {
      if (ov.type !== "zoom" || time < ov.start || time > ov.end) continue;
      const smoothScale = this.smoothZoomScale(
        ov.start,
        ov.end,
        ov.scale,
        time,
        ov.smoothness ?? 0.75,
        ov.zoomInDuration ?? 0.8,
        ov.zoomOutDuration ?? 0.8,
      );
      this.applyZoom(ctx, ov.x, ov.y, ov.w, ov.h, smoothScale, ov.mode ?? "focus");
    }

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
      ctx.drawImage(ctx.canvas, 0, 0, W, H);
      const tintOpacity = Math.max(0, Math.min(1, ov.opacity ?? 0));
      if (tintOpacity > 0) {
        ctx.globalAlpha = tintOpacity;
        ctx.fillStyle = ov.color ?? "#000000";
        ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.restore();
    }

    ctx.filter = "none";
    for (const ov of overlays) {
      if (ov.type !== "media" || time < ov.start || time > ov.end) continue;
      const asset = media.find((m) => m.id === ov.mediaId);
      if (!asset || asset.kind === "audio") continue;
      this.drawPipMedia(ctx, asset, ov.x, ov.y, ov.w, ov.h, ov.opacity, ov.borderRadius);
    }

    for (const ov of overlays) {
      if (ov.type !== "shape" || time < ov.start || time > ov.end) continue;
      const rx = ov.x * W;
      const ry = ov.y * H;
      const rw = ov.w * W;
      const rh = ov.h * H;
      ctx.save();
      ctx.lineWidth = Math.max(1, ov.strokeWidth);
      ctx.strokeStyle = ov.color;
      if (ov.fill) {
        ctx.fillStyle = ov.color;
        ctx.globalAlpha = Math.max(0, Math.min(1, ov.fillOpacity));
      }
      if (ov.shape === "rect") {
        if (ov.fill) ctx.fillRect(rx, ry, rw, rh);
        ctx.globalAlpha = 1;
        ctx.strokeRect(rx, ry, rw, rh);
      } else if (ov.shape === "circle") {
        ctx.beginPath();
        ctx.ellipse(rx + rw / 2, ry + rh / 2, Math.abs(rw) / 2, Math.abs(rh) / 2, 0, 0, Math.PI * 2);
        if (ov.fill) ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      } else {
        const x1 = rx;
        const y1 = ry;
        const x2 = rx + rw;
        const y2 = ry + rh;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (ov.shape === "arrow") {
          const a = Math.atan2(y2 - y1, x2 - x1);
          const len = 14 + ov.strokeWidth * 0.9;
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - len * Math.cos(a - Math.PI / 7), y2 - len * Math.sin(a - Math.PI / 7));
          ctx.lineTo(x2 - len * Math.cos(a + Math.PI / 7), y2 - len * Math.sin(a + Math.PI / 7));
          ctx.closePath();
          ctx.fillStyle = ov.color;
          ctx.fill();
        }
      }
      ctx.restore();
    }

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
