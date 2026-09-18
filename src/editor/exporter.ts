import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";
import type { MediaAsset, Overlay, Track } from "./types";
import { clipDuration, clipEnd } from "./types";
import { engine } from "./engine";

export type ExportOpts = {
  tracks: Track[];
  media: MediaAsset[];
  overlays: Overlay[];
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  container: "mp4" | "webm";
  duration: number;
  onProgress?: (p: number) => void;
};

export function webCodecsAvailable() {
  return typeof window !== "undefined" && "VideoEncoder" in window && "AudioEncoder" in window;
}

const SAMPLE_RATE = 48000;
const CHANNELS = 2;

/** Seek a video element to an exact time and wait until the frame is decoded. */
function seekTo(el: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    if (el.readyState >= 2 && Math.abs(el.currentTime - t) < 0.001) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("seeked", finish);
      resolve();
    };
    el.addEventListener("seeked", finish);
    try {
      el.currentTime = t;
    } catch {
      finish();
    }
    setTimeout(finish, 2000);
  });
}

async function waitReady(el: HTMLMediaElement) {
  if (el.readyState >= 2) return;
  await new Promise<void>((resolve) => {
    const on = () => {
      el.removeEventListener("loadeddata", on);
      resolve();
    };
    el.addEventListener("loadeddata", on);
    el.load();
    setTimeout(on, 5000);
  });
}

/** Mix the whole timeline audio offline, honouring clip/track mute and volume. */
async function renderAudio(opts: ExportOpts): Promise<AudioBuffer | null> {
  const { tracks, media, duration } = opts;
  const audible: { url: string; start: number; in: number; dur: number; vol: number }[] = [];
  for (const t of tracks) {
    if (t.muted) continue;
    for (const c of t.clips) {
      if (c.muted || c.volume <= 0) continue;
      const asset = media.find((m) => m.id === c.mediaId);
      if (!asset) continue;
      audible.push({ url: asset.url, start: c.start, in: c.in, dur: clipDuration(c), vol: c.volume });
    }
  }
  if (!audible.length) return null;

  const frames = Math.ceil(duration * SAMPLE_RATE);
  if (frames <= 0) return null;
  const offline = new OfflineAudioContext(CHANNELS, frames, SAMPLE_RATE);
  const cache = new Map<string, AudioBuffer | null>();

  for (const a of audible) {
    let buf = cache.get(a.url);
    if (buf === undefined) {
      try {
        const raw = await (await fetch(a.url)).arrayBuffer();
        buf = await offline.decodeAudioData(raw);
      } catch {
        buf = null;
      }
      cache.set(a.url, buf);
    }
    if (!buf) continue;
    const src = offline.createBufferSource();
    src.buffer = buf;
    const g = offline.createGain();
    g.gain.value = a.vol;
    src.connect(g);
    g.connect(offline.destination);
    const offset = Math.max(0, Math.min(a.in, buf.duration));
    const len = Math.max(0, Math.min(a.dur, buf.duration - offset));
    if (len <= 0) continue;
    src.start(a.start, offset, len);
  }
  return offline.startRendering();
}

async function pickVideoCodec(want: "mp4" | "webm", width: number, height: number, fps: number) {
  const list =
    want === "mp4"
      ? ["avc1.640033", "avc1.4d0034", "avc1.42E01E"]
      : ["vp09.00.10.08", "vp8"];
  for (const codec of list) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps });
      if (r.supported) return codec;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function exportTimeline(opts: ExportOpts): Promise<{ blob: Blob; container: "mp4" | "webm" }> {
  const { width, height, fps, duration, onProgress } = opts;
  let container = opts.container;
  const totalFrames = Math.max(1, Math.round(duration * fps));

  let videoCodec = await pickVideoCodec(container, width, height, fps);
  if (!videoCodec) {
    const alt = container === "mp4" ? "webm" : "mp4";
    videoCodec = await pickVideoCodec(alt, width, height, fps);
    if (!videoCodec) throw new Error("This browser has no supported video encoder.");
    container = alt;
  }

  const audioBuffer = await renderAudio(opts);

  const target = container === "mp4" ? new Mp4Target() : new WebmTarget();

  const muxer =
    container === "mp4"
      ? new Mp4Muxer({
          target: target as Mp4Target,
          video: { codec: "avc", width, height },
          ...(audioBuffer
            ? { audio: { codec: "aac" as const, numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE } }
            : {}),
          fastStart: "in-memory" as const,
        })
      : new WebmMuxer({
          target: target as WebmTarget,
          video: { codec: "V_VP9", width, height, frameRate: fps },
          ...(audioBuffer
            ? { audio: { codec: "A_OPUS" as const, numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE } }
            : {}),
        });

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => (muxer as Mp4Muxer<Mp4Target>).addVideoChunk(chunk, meta),
    error: (e) => console.error(e),
  });
  videoEncoder.configure({
    codec: videoCodec,
    width,
    height,
    framerate: fps,
    bitrate: Math.round(opts.bitrateMbps * 1_000_000),
    ...(container === "mp4" ? { avc: { format: "avc" as const } } : {}),
  });

  // Offscreen canvas rendered by the same engine used for the preview.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const byId = new Map(opts.media.map((m) => [m.id, m]));
  for (const m of opts.media) {
    const node = engine.get(m);
    if (m.kind === "image") continue;
    const el = node as HTMLMediaElement;
    el.pause();
    el.muted = true;
    await waitReady(el);
  }

  const frameDur = 1 / fps;
  for (let i = 0; i < totalFrames; i++) {
    const t = i * frameDur;
    // Seek the clip that is visible at this exact timeline second.
    const active = engine.activeVisualClip(opts.tracks, opts.media, t);
    if (active) {
      const asset = byId.get(active.clip.mediaId);
      if (asset && asset.kind === "video") {
        const el = engine.get(asset) as HTMLVideoElement;
        const src = Math.min(
          Math.max(active.clip.in + (t - active.clip.start), 0),
          Math.max((asset.duration || 0) - 0.02, 0),
        );
        await seekTo(el, src);
      }
    }
    engine.render(ctx, opts.tracks, opts.media, opts.overlays, t);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(t * 1_000_000),
      duration: Math.round(frameDur * 1_000_000),
    });
    videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (videoEncoder.encodeQueueSize > 8) {
      await new Promise<void>((r) => {
        const check = () => (videoEncoder.encodeQueueSize <= 4 ? r() : setTimeout(check, 5));
        check();
      });
    }
    onProgress?.((i + 1) / totalFrames * (audioBuffer ? 0.9 : 1));
  }
  await videoEncoder.flush();
  videoEncoder.close();

  if (audioBuffer) {
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => (muxer as Mp4Muxer<Mp4Target>).addAudioChunk(chunk, meta),
      error: (e) => console.error(e),
    });
    audioEncoder.configure({
      codec: container === "mp4" ? "mp4a.40.2" : "opus",
      numberOfChannels: CHANNELS,
      sampleRate: SAMPLE_RATE,
      bitrate: 128_000,
    });
    const chunkFrames = 1024;
    const total = audioBuffer.length;
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
    for (let off = 0; off < total; off += chunkFrames) {
      const n = Math.min(chunkFrames, total - off);
      const data = new Float32Array(n * CHANNELS);
      data.set(ch0.subarray(off, off + n), 0);
      data.set(ch1.subarray(off, off + n), n);
      const ad = new AudioData({
        format: "f32-planar",
        sampleRate: SAMPLE_RATE,
        numberOfFrames: n,
        numberOfChannels: CHANNELS,
        timestamp: Math.round((off / SAMPLE_RATE) * 1_000_000),
        data,
      });
      audioEncoder.encode(ad);
      ad.close();
      onProgress?.(0.9 + (off / total) * 0.1);
    }
    await audioEncoder.flush();
    audioEncoder.close();
  }

  muxer.finalize();
  const buffer = (target as Mp4Target).buffer!;
  onProgress?.(1);
  return {
    blob: new Blob([buffer], { type: container === "mp4" ? "video/mp4" : "video/webm" }),
    container,
  };
}

export { clipEnd };
