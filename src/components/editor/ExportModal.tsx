import { useState } from "react";
import { useEditor } from "@/editor/store";
import { exportTimeline, webCodecsAvailable } from "@/editor/exporter";

const RESOLUTIONS = [
  { label: "3840 × 2160 (4K)", w: 3840, h: 2160 },
  { label: "1920 × 1080 (Full HD)", w: 1920, h: 1080 },
  { label: "1280 × 720 (HD)", w: 1280, h: 720 },
  { label: "854 × 480 (SD)", w: 854, h: 480 },
  { label: "1080 × 1920 (Vertical)", w: 1080, h: 1920 },
  { label: "1080 × 1080 (Square)", w: 1080, h: 1080 },
];

const FPS = [24, 25, 30, 50, 60];

export default function ExportModal({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const { exportSettings: s, setExportSettings } = ed;
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startExport = async () => {
    setError(null);
    if (ed.duration <= 0) {
      setError("Timeline is empty — add a clip first.");
      return;
    }
    if (!webCodecsAvailable()) {
      setError("This browser cannot encode video. Use a recent Chrome or Edge.");
      return;
    }

    ed.setPlaying(false);
    setProgress(0);
    try {
      const { blob, container } = await exportTimeline({
        tracks: ed.tracks,
        media: ed.media,
        overlays: ed.overlays,
        width: s.width,
        height: s.height,
        fps: s.fps,
        bitrateMbps: s.bitrateMbps,
        container: s.container,
        duration: ed.duration,
        onProgress: setProgress,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${Date.now()}.${container}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      setProgress(null);
      if (container !== s.container) {
        setError(`${s.container.toUpperCase()} encoding is unavailable here — saved as ${container.toUpperCase()}.`);
        return;
      }
      onClose();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Export failed.");
      setProgress(null);
    }
  };

  const busy = progress !== null;


  return (
    <div className="ed-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="ed-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ed-modal-header">Export video</div>
        <div className="ed-modal-body">
          <div className="ed-field">
            <label>Format</label>
            <select
              className="ed-select"
              value={s.container}
              onChange={(e) => setExportSettings({ ...s, container: e.target.value as "webm" | "mp4" })}
            >
              <option value="webm">WebM (VP9)</option>
              <option value="mp4">MP4 (H.264)</option>
            </select>
          </div>
          <div className="ed-field">
            <label>Resolution</label>
            <select
              className="ed-select"
              value={`${s.width}x${s.height}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split("x").map(Number);
                setExportSettings({ ...s, width: w ?? 1280, height: h ?? 720 });
              }}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.label} value={`${r.w}x${r.h}`}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ed-field">
            <label>Frame rate</label>
            <select
              className="ed-select"
              value={s.fps}
              onChange={(e) => setExportSettings({ ...s, fps: Number(e.target.value) })}
            >
              {FPS.map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
          </div>
          <div className="ed-field">
            <label>Quality — {s.bitrateMbps} Mbps</label>
            <input
              type="range"
              className="w-100"
              min={1}
              max={40}
              value={s.bitrateMbps}
              onChange={(e) => setExportSettings({ ...s, bitrateMbps: Number(e.target.value) })}
            />
          </div>

          {error && (
            <div className="ed-field" style={{ color: "#ffb4b4", fontSize: 12 }}>
              {error}
            </div>
          )}

          {busy && (
            <div className="ed-field">
              <div className="ed-progress">
                <div style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--ed-muted)", marginTop: 6 }}>
                Encoding frame-accurate video — {Math.round((progress ?? 0) * 100)}%
              </div>
            </div>
          )}

          <div className="ed-field" style={{ fontSize: 11, color: "var(--ed-muted)" }}>
            Export encodes every frame exactly at the chosen frame rate, with muted clips and tracks silenced.
          </div>

        </div>
        <div className="ed-modal-footer">
          <button className="ed-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="ed-btn primary" onClick={() => void startExport()} disabled={busy}>
            ⬇ Export
          </button>
        </div>
      </div>
    </div>
  );
}
