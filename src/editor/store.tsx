import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Clip, ExportSettings, MediaAsset, Overlay, Track } from "./types";
import { clipDuration, clipEnd, resolveStart, uid } from "./types";
import { engine } from "./engine";

type Selection = { kind: "clip"; id: string } | { kind: "overlay"; id: string } | null;

type Ctx = ReturnType<typeof useEditorState>;
const EditorCtx = createContext<Ctx | null>(null);

function newTrack(name: string): Track {
  return { id: uid(), name, muted: false, hidden: false, clips: [] };
}

type Snapshot = { tracks: Track[]; overlays: Overlay[] };

function useEditorState() {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [tracks, setTracksState] = useState<Track[]>([newTrack("Video 1"), newTrack("Video 2")]);
  const [overlays, setOverlaysState] = useState<Overlay[]>([]);

  // ---- undo / redo history -------------------------------------------------
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const tracksRef = useRef(tracks);
  const overlaysRef = useRef(overlays);
  tracksRef.current = tracks;
  overlaysRef.current = overlays;
  const [histVer, setHistVer] = useState(0);

  const pushHistory = useCallback(() => {
    past.current.push({ tracks: tracksRef.current, overlays: overlaysRef.current });
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setHistVer((v) => v + 1);
  }, []);

  /** History-aware setters used by every editing action. */
  const setTracks = useCallback(
    (upd: Track[] | ((prev: Track[]) => Track[])) => {
      pushHistory();
      setTracksState(upd);
    },
    [pushHistory],
  );
  const setOverlays = useCallback(
    (upd: Overlay[] | ((prev: Overlay[]) => Overlay[])) => {
      pushHistory();
      setOverlaysState(upd);
    },
    [pushHistory],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push({ tracks: tracksRef.current, overlays: overlaysRef.current });
    setTracksState(prev.tracks);
    setOverlaysState(prev.overlays);
    setSelection(null);
    setHistVer((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push({ tracks: tracksRef.current, overlays: overlaysRef.current });
    setTracksState(next.tracks);
    setOverlaysState(next.overlays);
    setSelection(null);
    setHistVer((v) => v + 1);
  }, []);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;
  void histVer;

  const [selection, setSelection] = useState<Selection>(null);
  const [playhead, setPlayheadState] = useState(0);
  const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(false);

  const [zoom, setZoom] = useState(80); // px per second
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    container: "webm",
    fps: 30,
    width: 1280,
    height: 720,
    bitrateMbps: 8,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const duration = useMemo(() => {
    let d = 0;
    for (const t of tracks) for (const c of t.clips) d = Math.max(d, clipEnd(c));
    return d;
  }, [tracks]);

  const selectedClip = useMemo(() => {
    if (selection?.kind !== "clip") return null;
    for (const t of tracks) {
      const c = t.clips.find((x) => x.id === selection.id);
      if (c) return { clip: c, trackId: t.id };
    }
    return null;
  }, [selection, tracks]);

  const selectedOverlay = useMemo(
    () => (selection?.kind === "overlay" ? (overlays.find((o) => o.id === selection.id) ?? null) : null),
    [selection, overlays],
  );

  const addMedia = useCallback(async (files: FileList | File[]) => {
    const added: MediaAsset[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video")) continue;
      const url = URL.createObjectURL(file);
      const meta = await new Promise<{ d: number; w: number; h: number; thumb?: string | undefined }>((resolve) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.muted = true;
        v.src = url;
        v.onloadeddata = () => {
          v.currentTime = Math.min(0.2, (v.duration || 1) / 2);
        };
        v.onseeked = () => {
          let thumb: string | undefined;
          try {
            const c = document.createElement("canvas");
            c.width = 160;
            c.height = 90;
            const cx = c.getContext("2d");
            cx?.drawImage(v, 0, 0, 160, 90);
            thumb = c.toDataURL("image/jpeg", 0.6);
          } catch {
            /* ignore */
          }
          resolve({ d: v.duration || 0, w: v.videoWidth, h: v.videoHeight, thumb });
        };
        v.onerror = () => resolve({ d: 0, w: 0, h: 0 });
      });
      added.push({
        id: uid(),
        name: file.name,
        url,
        duration: meta.d,
        width: meta.w,
        height: meta.h,
        thumbnail: meta.thumb,
      });
    }
    if (added.length) setMedia((m) => [...m, ...added]);
    return added;
  }, []);

  const addClip = useCallback((asset: MediaAsset, trackId?: string, at?: number) => {
    setTracks((ts) => {
      const idx = Math.max(
        0,
        ts.findIndex((t) => t.id === (trackId ?? ts[0]?.id)),
      );
      return ts.map((t, i) => {
        if (i !== idx) return t;
        const dur = Math.max(0.05, asset.duration || 5);
        const end = t.clips.reduce((a, c) => Math.max(a, clipEnd(c)), 0);
        const start = at === undefined ? end : resolveStart(t.clips, at, dur);
        const clip: Clip = {
          id: uid(),
          mediaId: asset.id,
          name: asset.name,
          start,
          in: 0,
          out: asset.duration || 5,
          muted: false,
          volume: 1,
          cropLeft: 0,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
        };
        return { ...t, clips: [...t.clips, clip] };
      });
    });
  }, []);

  /** Nearest non-overlapping start for a clip of `dur` on a given track. */
  const previewStart = useCallback(
    (trackId: string, desired: number, dur: number, ignoreId?: string) => {
      const t = tracks.find((x) => x.id === trackId);
      if (!t) return Math.max(0, desired);
      return resolveStart(t.clips, desired, dur, ignoreId);
    },
    [tracks],
  );

  /** Commit a drag: move clip to a track at the nearest free position. */
  const commitMove = useCallback((clipId: string, trackId: string, desired: number) => {
    setTracks((ts) => {
      let moving: Clip | null = null;
      const stripped = ts.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => {
          if (c.id === clipId) {
            moving = c;
            return false;
          }
          return true;
        }),
      }));
      const m = moving as Clip | null;
      if (!m) return ts;
      return stripped.map((t) =>
        t.id === trackId
          ? { ...t, clips: [...t.clips, { ...m, start: resolveStart(t.clips, desired, clipDuration(m)) }] }
          : t,
      );
    });
  }, []);

  /** Patch a clip, clamping start/out so it never overlaps neighbours on its track. */
  const updateClip = useCallback((clipId: string, patch: Partial<Clip>) => {
    setTracks((ts) =>
      ts.map((t) => {
        if (!t.clips.some((c) => c.id === clipId)) return t;
        return {
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== clipId) return c;
            const next = { ...c, ...patch };
            const others = t.clips.filter((o) => o.id !== clipId).sort((a, b) => a.start - b.start);
            const prevEnd = others.filter((o) => clipEnd(o) <= c.start + 0.001).reduce((a, o) => Math.max(a, clipEnd(o)), 0);
            const nextStart = others.find((o) => o.start >= c.start - 0.001)?.start ?? Infinity;
            // keep trim (out) from running into the following clip
            if (next.out !== c.out) {
              const maxDur = nextStart - next.start;
              if (isFinite(maxDur)) next.out = Math.min(next.out, next.in + Math.max(0.05, maxDur));
            }
            // keep start inside the free gap
            const dur = clipDuration(next);
            const maxStart = isFinite(nextStart) ? nextStart - dur : Infinity;
            next.start = Math.max(prevEnd, Math.min(next.start, isFinite(maxStart) ? maxStart : next.start));
            next.start = Math.max(0, next.start);
            return next;
          }),
        };
      }),
    );
  }, []);


  const moveClipToTrack = useCallback((clipId: string, trackId: string, start: number) => {
    setTracks((ts) => {
      let moving: Clip | null = null;
      const stripped = ts.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => {
          if (c.id === clipId) {
            moving = c;
            return false;
          }
          return true;
        }),
      }));
      if (!moving) return ts;
      return stripped.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: [
                ...t.clips,
                { ...(moving as Clip), start: resolveStart(t.clips, Math.max(0, start), clipDuration(moving as Clip)) },
              ],
            }
          : t,

      );
    });
  }, []);

  const removeClip = useCallback((clipId: string) => {
    setTracks((ts) => ts.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })));
    setSelection(null);
  }, []);

  /** Split every clip crossing the playhead (or the selected clip). */
  const splitAt = useCallback((time: number, onlyClipId?: string) => {
    setTracks((ts) =>
      ts.map((t) => {
        const next: Clip[] = [];
        for (const c of t.clips) {
          const crosses = time > c.start + 0.05 && time < clipEnd(c) - 0.05;
          if (!crosses || (onlyClipId && c.id !== onlyClipId)) {
            next.push(c);
            continue;
          }
          const offset = time - c.start;
          next.push({ ...c, out: c.in + offset });
          next.push({ ...c, id: uid(), start: time, in: c.in + offset });
        }
        return { ...t, clips: next };
      }),
    );
  }, []);

  /** Merge the selected clip with the next adjacent clip from the same source. */
  const mergeSelected = useCallback(() => {
    if (selection?.kind !== "clip") return;
    const id = selection.id;
    setTracks((ts) =>
      ts.map((t) => {
        const sorted = [...t.clips].sort((a, b) => a.start - b.start);
        const i = sorted.findIndex((c) => c.id === id);
        if (i < 0 || i === sorted.length - 1) return t;
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        if (a.mediaId !== b.mediaId) return t;
        if (Math.abs(clipEnd(a) - b.start) > 0.3) return t;
        const merged: Clip = { ...a, out: a.in + clipDuration(a) + clipDuration(b) };
        return { ...t, clips: sorted.filter((c) => c.id !== a.id && c.id !== b.id).concat(merged) };
      }),
    );
  }, [selection]);

  /**
   * Split a clip by an explicit timeline range (from → to).
   * mode "keep": only that range survives. mode "remove": that range is cut out.
   */
  const applyRange = useCallback((clipId: string, from: number, to: number, mode: "keep" | "remove") => {
    setTracks((ts) =>
      ts.map((t) => {
        if (!t.clips.some((c) => c.id === clipId)) return t;
        const next: Clip[] = [];
        for (const c of t.clips) {
          if (c.id !== clipId) {
            next.push(c);
            continue;
          }
          const cs = c.start;
          const ce = clipEnd(c);
          const a = Math.max(cs, Math.min(from, to));
          const b = Math.min(ce, Math.max(from, to));
          if (b - a < 0.05) {
            next.push(c);
            continue;
          }
          if (mode === "keep") {
            next.push({ ...c, start: a, in: c.in + (a - cs), out: c.in + (b - cs) });
          } else {
            if (a - cs > 0.05) next.push({ ...c, out: c.in + (a - cs) });
            if (ce - b > 0.05)
              next.push({ ...c, id: uid(), start: b, in: c.in + (b - cs), out: c.in + (ce - cs) });
          }
        }
        return { ...t, clips: next };
      }),
    );
    setSelection(null);
  }, []);


  const rippleTrack = useCallback((trackId: string) => {
    setTracks((ts) =>
      ts.map((t) => {
        if (t.id !== trackId) return t;
        let cursor = 0;
        const clips = [...t.clips]
          .sort((a, b) => a.start - b.start)
          .map((c) => {
            const nc = { ...c, start: cursor };
            cursor += clipDuration(c);
            return nc;
          });
        return { ...t, clips };
      }),
    );
  }, []);

  const addTrack = useCallback(() => setTracks((ts) => [...ts, newTrack(`Video ${ts.length + 1}`)]), []);
  const removeTrack = useCallback(
    (id: string) => setTracks((ts) => (ts.length <= 1 ? ts : ts.filter((t) => t.id !== id))),
    [],
  );
  const updateTrack = useCallback(
    (id: string, patch: Partial<Track>) => setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    [],
  );

  const addTextOverlay = useCallback(
    (at: number) => {
      const o: Overlay = {
        id: uid(),
        type: "text",
        text: "Your text here",
        start: at,
        end: at + Math.min(4, Math.max(2, duration - at || 4)),
        x: 0.15,
        y: 0.72,
        w: 0.7,
        h: 0.12,
        size: 64,
        color: "#ffffff",
        bg: "transparent",
        bgEnabled: false,
        align: "center",
      };
      setOverlays((os) => [...os, o]);
      setSelection({ kind: "overlay", id: o.id });
    },
    [duration],
  );

  const addBlurOverlay = useCallback(
    (at: number) => {
      const o: Overlay = {
        id: uid(),
        type: "blur",
        start: at,
        end: at + Math.min(4, Math.max(2, duration - at || 4)),
        x: 0.35,
        y: 0.3,
        w: 0.3,
        h: 0.25,
        amount: 18,
      };
      setOverlays((os) => [...os, o]);
      setSelection({ kind: "overlay", id: o.id });
    },
    [duration],
  );

  const updateOverlay = useCallback((id: string, patch: Partial<Overlay>) => {
    setOverlays((os) => os.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o)));
  }, []);
  const removeOverlay = useCallback((id: string) => {
    setOverlays((os) => os.filter((o) => o.id !== id));
    setSelection(null);
  }, []);

  /** Writes the ref immediately (smooth canvas) and commits to React state. */
  const setPlayhead = useCallback((t: number) => {
    const v = Math.max(0, t);
    playheadRef.current = v;
    setPlayheadState(v);
  }, []);

  /** Ref-only update, used by the playback loop between UI commits. */
  const setPlayheadSilent = useCallback((t: number) => {
    playheadRef.current = Math.max(0, t);
  }, []);

  const seek = useCallback((t: number) => setPlayhead(t), [setPlayhead]);

  return {
    engine,
    undo,
    redo,
    canUndo,
    canRedo,

    media,
    tracks,
    overlays,
    selection,
    setSelection,
    selectedClip,
    selectedOverlay,
    playhead,
    playheadRef,
    setPlayhead,
    setPlayheadSilent,
    seek,
    playing,
    setPlaying,
    zoom,
    setZoom,
    duration,
    canvasRef,
    exportSettings,
    setExportSettings,
    addMedia,
    addClip,
    updateClip,
    moveClipToTrack,
    commitMove,
    previewStart,
    removeClip,
    splitAt,
    mergeSelected,
    rippleTrack,
    applyRange,
    addTrack,
    removeTrack,
    updateTrack,
    addTextOverlay,
    addBlurOverlay,
    updateOverlay,
    removeOverlay,
  };
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const value = useEditorState();
  return <EditorCtx.Provider value={value}>{children}</EditorCtx.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error("useEditor must be used inside EditorProvider");
  return ctx;
}
