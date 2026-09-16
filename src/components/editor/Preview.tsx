import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/editor/store";
import type { Overlay } from "@/editor/types";

export default function Preview() {
  const ed = useEditor();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);
  const [drag, setDrag] = useState<
    | null
    | { id: string; mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  >(null);

  const { engine, tracks, media, overlays, playing, duration, canvasRef, exportSettings } = ed;

  // Keep video elements created for every asset.
  useEffect(() => {
    media.forEach((m) => engine.get(m));
  }, [media, engine]);

  // Main render / playback loop. The playhead lives in a ref so the canvas stays
  // smooth; React state is only committed a few times per second to avoid
  // re-rendering the whole editor on every frame (that caused the stutter).
  const commitRef = useRef(0);
  useEffect(() => {
    const loop = (ts: number) => {
      const dt = lastRef.current ? Math.min((ts - lastRef.current) / 1000, 0.25) : 0;
      lastRef.current = ts;
      let time = ed.playheadRef.current;
      if (playing) time = time + dt;

      // The engine returns the time derived from the playing video element,
      // which keeps the playhead locked to real decoded playback.
      const synced = engine.sync(tracks, media, time, playing);
      if (playing) {
        // Never move backwards: that is what made a second repeat.
        time = Math.max(time - 0.02, Math.min(synced, time + 0.25));
        if (time >= duration) {
          time = duration;
          ed.setPlayhead(duration);
          ed.setPlaying(false);
        } else {
          ed.setPlayheadSilent(time);
          if (ts - commitRef.current > 100) {
            commitRef.current = ts;
            ed.setPlayhead(time);
          }
        }
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) engine.render(ctx, tracks, media, overlays, time);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastRef.current = 0;
    };
  });

  // Overlay box interaction (drag / resize on the preview).
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = (e.clientX - drag.sx) / rect.width;
      const dy = (e.clientY - drag.sy) / rect.height;
      if (drag.mode === "move") {
        ed.updateOverlay(drag.id, {
          x: Math.min(Math.max(drag.ox + dx, 0), 1 - drag.ow),
          y: Math.min(Math.max(drag.oy + dy, 0), 1 - drag.oh),
        } as Partial<Overlay>);
      } else {
        ed.updateOverlay(drag.id, {
          w: Math.min(Math.max(drag.ow + dx, 0.05), 1 - drag.ox),
          h: Math.min(Math.max(drag.oh + dy, 0.05), 1 - drag.oy),
        } as Partial<Overlay>);
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, ed]);

  const visible = overlays.filter((o) => ed.playhead >= o.start && ed.playhead <= o.end);

  return (
    <div className="ed-stage">
      <div className="ed-canvas-wrap" ref={wrapRef} style={{ aspectRatio: `${exportSettings.width}/${exportSettings.height}` }}>
        <canvas ref={canvasRef} width={exportSettings.width} height={exportSettings.height} />
        <div className="ed-overlay-layer">
          {visible.map((o) => (
            <div
              key={o.id}
              className={`ed-ov-box ${ed.selection?.kind === "overlay" && ed.selection.id === o.id ? "active" : ""}`}
              style={{
                left: `${o.x * 100}%`,
                top: `${o.y * 100}%`,
                width: `${o.w * 100}%`,
                height: `${o.h * 100}%`,
                borderColor: o.type === "blur" ? "rgba(255,107,107,.9)" : undefined,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                ed.setSelection({ kind: "overlay", id: o.id });
                setDrag({ id: o.id, mode: "move", sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, ow: o.w, oh: o.h });
              }}
            >
              <span
                className="ed-ov-handle"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  ed.setSelection({ kind: "overlay", id: o.id });
                  setDrag({
                    id: o.id,
                    mode: "resize",
                    sx: e.clientX,
                    sy: e.clientY,
                    ox: o.x,
                    oy: o.y,
                    ow: o.w,
                    oh: o.h,
                  });
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
