import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/editor/store";
import { clipDuration, clipEnd } from "@/editor/types";
import { dragMedia } from "@/editor/dragBus";

type DragState = {
  clipId: string;
  mode: "move" | "trim-left" | "trim-right";
  startX: number;
  origStart: number;
  origIn: number;
  origOut: number;
  fromTrack: string;
};

const HEAD = 140;

type RangeDlg = { clipId: string; name: string; from: string; to: string; mode: "keep" | "remove" };
type MenuState = { x: number; y: number; clipId: string; name: string; start: number; end: number };
type Hint = { trackId: string; start: number; dur: number };

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
const tickStep = (zoom: number) => STEPS.find((s) => s * zoom >= 76) ?? STEPS[STEPS.length - 1]!;
const tickLabel = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function Timeline() {
  const ed = useEditor();
  const { tracks, zoom, duration, playhead } = ed;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dlg, setDlg] = useState<RangeDlg | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  // Horizontal wheel/trackpad panning: handled natively (non-passive) so the
  // browser never turns a left-to-right swipe into a back-navigation gesture.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
        el.scrollLeft += dx;
      } else if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += dy;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const width = Math.max(duration + 12, 30) * zoom;

  useEffect(() => {
    if (!drag) return;
    const trackAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      const row = el?.closest("[data-track-id]") as HTMLElement | null;
      return row?.dataset["trackId"];
    };
    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - drag.startX) / zoom;
      if (drag.mode === "move") {
        const desired = Math.max(0, drag.origStart + dx);

        const targetTrack = trackAt(e.clientX, e.clientY) ?? drag.fromTrack;
        const dur = Math.max(0.05, drag.origOut - drag.origIn);
        setHint({ trackId: targetTrack, start: ed.previewStart(targetTrack, desired, dur, drag.clipId), dur });
      } else if (drag.mode === "trim-left") {
        const nin = Math.min(Math.max(0, drag.origIn + dx), drag.origOut - 0.15);
        ed.updateClip(drag.clipId, { in: nin, start: Math.max(0, drag.origStart + (nin - drag.origIn)) });
      } else {
        ed.updateClip(drag.clipId, { out: Math.max(drag.origIn + 0.15, drag.origOut + dx) });
      }
    };
    const onUp = (e: PointerEvent) => {
      if (drag.mode === "move") {
        const targetTrack = trackAt(e.clientX, e.clientY) ?? drag.fromTrack;
        const dx = (e.clientX - drag.startX) / zoom;
        ed.commitMove(drag.clipId, targetTrack, Math.max(0, drag.origStart + dx));
      }
      setHint(null);
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, ed, zoom]);

  const scrub = (e: React.MouseEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    ed.seek((e.clientX - box.left) / zoom);
  };

  const ticks: number[] = [];
  const step = tickStep(zoom);
  for (let t = 0; t * step * zoom < width; t++) ticks.push(t * step);

  return (
    <div className="ed-timeline">
      <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--ed-line)" }}>
        <strong style={{ fontSize: 12, letterSpacing: 1 }}>TIMELINE</strong>
        <button className="ed-btn" onClick={() => ed.splitAt(playhead)} title="Split at playhead (S)">
          ✂ Split
        </button>
        <button className="ed-btn" onClick={ed.mergeSelected} disabled={ed.selection?.kind !== "clip"}>
          ⇥⇤ Merge
        </button>
        <button
          className="ed-btn danger"
          disabled={ed.selection?.kind !== "clip"}
          onClick={() => ed.selection?.kind === "clip" && ed.removeClip(ed.selection.id)}
        >
          🗑 Delete
        </button>
        <button className="ed-btn" onClick={ed.addTrack}>
          ＋ Track
        </button>
        <div className="ms-auto d-flex align-items-center gap-2">
          <button className="ed-btn" onClick={() => ed.setZoom(Math.max(20, zoom - 20))} title="Zoom out">−</button>
          <input
            type="range"
            min={2}
            max={240}
            value={zoom}
            onChange={(e) => ed.setZoom(Number(e.target.value))}
            style={{ width: 120 }}
          />
          <button className="ed-btn" onClick={() => ed.setZoom(Math.min(240, zoom + 20))} title="Zoom in">＋</button>
          <span className="ed-time">Zoom</span>
        </div>
      </div>

      <div className="ed-tl-scroll" ref={scrollRef}>
        <div style={{ minWidth: HEAD + width }}>
          <div className="ed-ruler" style={{ position: "sticky", top: 0 }}>
            <div style={{ position: "relative", marginLeft: HEAD, height: "100%" }} onMouseDown={scrub}>
              {ticks.map((t) => (
                <div key={t} className="ed-ruler-tick" style={{ left: t * zoom }}>
                  {tickLabel(t)}
                </div>
              ))}
              <div className="ed-playhead" style={{ left: playhead * zoom, height: 26 }} />
            </div>
          </div>

          {tracks.map((track) => (
            <div className="ed-track" key={track.id}>
              <div className="ed-track-head">
                <div className="fw-semibold mb-1">{track.name}</div>
                <div className="d-flex gap-1">
                  <button
                    className="ed-btn"
                    style={{ padding: "2px 6px" }}
                    title="Mute track"
                    onClick={() => ed.updateTrack(track.id, { muted: !track.muted })}
                  >
                    {track.muted ? "🔇" : "🔊"}
                  </button>
                  <button
                    className="ed-btn"
                    style={{ padding: "2px 6px" }}
                    title="Hide track"
                    onClick={() => ed.updateTrack(track.id, { hidden: !track.hidden })}
                  >
                    {track.hidden ? "🚫" : "👁"}
                  </button>
                  <button
                    className="ed-btn"
                    style={{ padding: "2px 6px" }}
                    title="Close gaps"
                    onClick={() => ed.rippleTrack(track.id)}
                  >
                    ⇤
                  </button>
                  <button
                    className="ed-btn danger"
                    style={{ padding: "2px 6px" }}
                    title="Remove track"
                    onClick={() => ed.removeTrack(track.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div
                className={`ed-track-body ${hint?.trackId === track.id ? "drop-target" : ""}`}
                data-track-id={track.id}
                style={{ width, backgroundSize: `${zoom}px 100%` }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) scrub(e);
                }}
                onDragOver={(e) => {
                  const id = e.dataTransfer.types.includes("text/x-media-id");
                  if (!id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  const box = e.currentTarget.getBoundingClientRect();
                  const desired = Math.max(0, (e.clientX - box.left) / zoom);
                  const asset = ed.media.find((m) => m.id === dragMedia.id);
                  const dur = Math.max(0.05, asset?.duration || 5);
                  setHint({ trackId: track.id, start: ed.previewStart(track.id, desired, dur), dur });
                }}
                onDragLeave={() => setHint(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const mediaId = e.dataTransfer.getData("text/x-media-id") || dragMedia.id;
                  const asset = ed.media.find((m) => m.id === mediaId);
                  if (!asset) return;
                  const box = e.currentTarget.getBoundingClientRect();
                  const desired = Math.max(0, (e.clientX - box.left) / zoom);
                  const safeStart = ed.previewStart(track.id, desired, Math.max(0.05, asset.duration || 5));
                  ed.addClip(asset, track.id, safeStart);
                  setHint(null);
                }}
              >
                {hint?.trackId === track.id && (
                  <div className="ed-drop-hint" style={{ left: hint.start * zoom, width: Math.max(1, hint.dur * zoom) }} />
                )}
                {[...track.clips].sort((a, b) => a.start - b.start).map((clip) => (
                  <div
                    key={clip.id}
                    className={`ed-clip ${ed.selection?.kind === "clip" && ed.selection.id === clip.id ? "selected" : ""}`}
                    style={{
                      left: clip.start * zoom,
                      // Exact timeline width is important: a minimum visual width
                      // makes adjacent clips appear to overlap at minute-level zoom.
                      width: Math.max(1, clipDuration(clip) * zoom),
                      opacity: track.hidden ? 0.4 : 1,
                    }}
                    onPointerDown={(e) => {
                      ed.setSelection({ kind: "clip", id: clip.id });
                      setDrag({
                        clipId: clip.id,
                        mode: "move",
                        startX: e.clientX,
                        origStart: clip.start,
                        origIn: clip.in,
                        origOut: clip.out,
                        fromTrack: track.id,
                      });
                    }}
                    onDoubleClick={() => ed.splitAt(playhead, clip.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      ed.setSelection({ kind: "clip", id: clip.id });
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        clipId: clip.id,
                        name: clip.name,
                        start: clip.start,
                        end: clip.start + clipDuration(clip),
                      });
                    }}
                  >
                    <div className="thumbs" />
                    <div className="label">
                      {clip.muted || track.muted ? "🔇 " : ""}
                      {clip.name} · {clipDuration(clip).toFixed(2)}s
                    </div>
                    <div
                      className="ed-trim left"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        ed.setSelection({ kind: "clip", id: clip.id });
                        setDrag({
                          clipId: clip.id,
                          mode: "trim-left",
                          startX: e.clientX,
                          origStart: clip.start,
                          origIn: clip.in,
                          origOut: clip.out,
                          fromTrack: track.id,
                        });
                      }}
                    />
                    <div
                      className="ed-trim right"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        ed.setSelection({ kind: "clip", id: clip.id });
                        setDrag({
                          clipId: clip.id,
                          mode: "trim-right",
                          startX: e.clientX,
                          origStart: clip.start,
                          origIn: clip.in,
                          origOut: clip.out,
                          fromTrack: track.id,
                        });
                      }}
                    />
                  </div>
                ))}
                <div className="ed-playhead" style={{ left: playhead * zoom }} />
              </div>
            </div>
          ))}

          <div className="ed-track" style={{ minHeight: 46 }}>
            <div className="ed-track-head" style={{ paddingTop: 12 }}>
              Overlays
            </div>
            <div className="ed-track-body" style={{ width, backgroundSize: `${zoom}px 100%` }}>
              {ed.overlays.map((o, i) => (
                <div
                  key={o.id}
                  onPointerDown={() => ed.setSelection({ kind: "overlay", id: o.id })}
                  style={{
                    position: "absolute",
                    left: o.start * zoom,
                    width: Math.max(20, (o.end - o.start) * zoom),
                    top: 6 + (i % 2) * 18,
                    height: 16,
                    borderRadius: 4,
                    fontSize: 10,
                    padding: "0 6px",
                    cursor: "pointer",
                    background: o.type === "text" ? "#3c8f6a" : "#8f3c4f",
                    border:
                      ed.selection?.kind === "overlay" && ed.selection.id === o.id
                        ? "1px solid var(--ed-accent)"
                        : "1px solid transparent",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {o.type === "text" ? `T · ${o.text}` : "Blur region"}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {menu && (
        <div
          className="ed-ctx"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="ed-ctx-title">{menu.name}</div>
          <button
            className="ed-ctx-item"
            onClick={() => {
              ed.splitAt(playhead, menu.clipId);
              setMenu(null);
            }}
          >
            ✂ Split at playhead
          </button>
          <button
            className="ed-ctx-item"
            onClick={() => {
              setDlg({
                clipId: menu.clipId,
                name: menu.name,
                from: menu.start.toFixed(2),
                to: menu.end.toFixed(2),
                mode: "keep",
              });
              setMenu(null);
            }}
          >
            ⌛ Split by time range…
          </button>
          <button
            className="ed-ctx-item danger"
            onClick={() => {
              ed.removeClip(menu.clipId);
              setMenu(null);
            }}
          >
            🗑 Delete clip
          </button>
        </div>
      )}

      {dlg && (
        <div className="ed-modal-backdrop" onMouseDown={() => setDlg(null)}>
          <div className="ed-modal p-3" onMouseDown={(e) => e.stopPropagation()}>
            <h6 className="mb-3">Split by time range · {dlg.name}</h6>
            <div className="row g-2 mb-3">
              <div className="col-6">
                <label className="ed-label">From (s)</label>
                <input
                  className="ed-input"
                  type="number"
                  step="0.01"
                  value={dlg.from}
                  onChange={(e) => setDlg({ ...dlg, from: e.target.value })}
                />
              </div>
              <div className="col-6">
                <label className="ed-label">To (s)</label>
                <input
                  className="ed-input"
                  type="number"
                  step="0.01"
                  value={dlg.to}
                  onChange={(e) => setDlg({ ...dlg, to: e.target.value })}
                />
              </div>
            </div>
            <div className="d-flex gap-2 mb-3">
              <button
                className={`ed-btn ${dlg.mode === "keep" ? "primary" : ""}`}
                onClick={() => setDlg({ ...dlg, mode: "keep" })}
              >
                Keep this range
              </button>
              <button
                className={`ed-btn ${dlg.mode === "remove" ? "primary" : ""}`}
                onClick={() => setDlg({ ...dlg, mode: "remove" })}
              >
                Remove this range
              </button>
            </div>
            <div className="d-flex justify-content-end gap-2">
              <button className="ed-btn" onClick={() => setDlg(null)}>
                Cancel
              </button>
              <button
                className="ed-btn primary"
                onClick={() => {
                  ed.applyRange(dlg.clipId, Number(dlg.from), Number(dlg.to), dlg.mode);
                  setDlg(null);
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { clipEnd };
