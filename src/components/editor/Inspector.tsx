import { useEditor } from "@/editor/store";
import { clipDuration, type TextOverlay, type BlurOverlay } from "@/editor/types";

export default function Inspector() {
  const ed = useEditor();
  const sel = ed.selectedClip;
  const ov = ed.selectedOverlay;

  return (
    <aside className="ed-side right">
      <div className="ed-panel-title">Properties</div>

      {!sel && !ov && <div className="ed-empty">Select a clip or an overlay to edit its properties.</div>}

      {sel && (
        <>
          <div className="ed-field">
            <label>Clip</label>
            <div className="text-truncate" style={{ fontSize: 13 }}>
              {sel.clip.name}
            </div>
          </div>
          <div className="ed-field">
            <label>Start on timeline (s)</label>
            <input
              className="ed-input"
              type="number"
              step={0.1}
              value={sel.clip.start.toFixed(2)}
              onChange={(e) => ed.updateClip(sel.clip.id, { start: Math.max(0, Number(e.target.value)) })}
            />
          </div>
          <div className="d-flex">
            <div className="ed-field flex-fill">
              <label>Trim in (s)</label>
              <input
                className="ed-input"
                type="number"
                step={0.1}
                value={sel.clip.in.toFixed(2)}
                onChange={(e) =>
                  ed.updateClip(sel.clip.id, { in: Math.min(Math.max(0, Number(e.target.value)), sel.clip.out - 0.1) })
                }
              />
            </div>
            <div className="ed-field flex-fill">
              <label>Trim out (s)</label>
              <input
                className="ed-input"
                type="number"
                step={0.1}
                value={sel.clip.out.toFixed(2)}
                onChange={(e) =>
                  ed.updateClip(sel.clip.id, { out: Math.max(sel.clip.in + 0.1, Number(e.target.value)) })
                }
              />
            </div>
          </div>
          <div className="ed-field">
            <label>Volume — {Math.round(sel.clip.volume * 100)}%</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              className="w-100"
              value={sel.clip.volume}
              onChange={(e) => ed.updateClip(sel.clip.id, { volume: Number(e.target.value) })}
            />
          </div>
          <div className="ed-field">
            <label>Crop</label>
            <div className="row g-2">
              <div className="col-6">
                <label className="ed-label">Left %</label>
                <input
                  className="ed-input"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={Math.round((sel.clip.cropLeft ?? 0) * 100)}
                  onChange={(e) =>
                    ed.updateClip(sel.clip.id, { cropLeft: Math.max(0, Math.min(0.5, Number(e.target.value) / 100)) })
                  }
                />
              </div>
              <div className="col-6">
                <label className="ed-label">Right %</label>
                <input
                  className="ed-input"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={Math.round((sel.clip.cropRight ?? 0) * 100)}
                  onChange={(e) =>
                    ed.updateClip(sel.clip.id, { cropRight: Math.max(0, Math.min(0.5, Number(e.target.value) / 100)) })
                  }
                />
              </div>
              <div className="col-6">
                <label className="ed-label">Top %</label>
                <input
                  className="ed-input"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={Math.round((sel.clip.cropTop ?? 0) * 100)}
                  onChange={(e) =>
                    ed.updateClip(sel.clip.id, { cropTop: Math.max(0, Math.min(0.5, Number(e.target.value) / 100)) })
                  }
                />
              </div>
              <div className="col-6">
                <label className="ed-label">Bottom %</label>
                <input
                  className="ed-input"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={Math.round((sel.clip.cropBottom ?? 0) * 100)}
                  onChange={(e) =>
                    ed.updateClip(sel.clip.id, { cropBottom: Math.max(0, Math.min(0.5, Number(e.target.value) / 100)) })
                  }
                />
              </div>
            </div>
          </div>
          <div className="ed-field d-flex gap-2">
            <button className="ed-btn" onClick={() => ed.updateClip(sel.clip.id, { muted: !sel.clip.muted })}>
              {sel.clip.muted ? "🔇 Unmute clip" : "🔊 Mute clip"}
            </button>
            <button className="ed-btn" onClick={() => ed.splitAt(ed.playhead, sel.clip.id)}>
              ✂ Split here
            </button>
          </div>
          <div className="ed-field" style={{ color: "var(--ed-muted)", fontSize: 11 }}>
            Duration {clipDuration(sel.clip).toFixed(2)}s
          </div>
        </>
      )}

      {ov && (
        <>
          <div className="ed-field">
            <label>{ov.type === "text" ? "Text overlay" : "Blur region"}</label>
          </div>
          {ov.type === "text" && (
            <>
              <div className="ed-field">
                <label>Content</label>
                <textarea
                  className="ed-input"
                  rows={3}
                  value={(ov as TextOverlay).text}
                  onChange={(e) => ed.updateOverlay(ov.id, { text: e.target.value } as Partial<TextOverlay>)}
                />
              </div>
              <div className="d-flex gap-2">
                <div className="ed-field flex-fill" style={{ minWidth: 0 }}>
                  <label>Size</label>
                  <input
                    className="ed-input"
                    type="number"
                    value={(ov as TextOverlay).size}
                    onChange={(e) => ed.updateOverlay(ov.id, { size: Number(e.target.value) } as Partial<TextOverlay>)}
                    style={{ minHeight: 34 }}
                  />
                </div>
                <div className="ed-field" style={{ width: 110, minWidth: 110, flex: "0 0 110px" }}>
                  <label>Color</label>
                  <input
                    className="ed-input"
                    type="color"
                    value={(ov as TextOverlay).color}
                    onChange={(e) => ed.updateOverlay(ov.id, { color: e.target.value } as Partial<TextOverlay>)}
                    style={{ minHeight: 34, width: "100%", padding: 0, borderRadius: 6 }}
                  />
                </div>
              </div>
              <div className="ed-field">
                <label>Alignment</label>
                <select
                  className="ed-select"
                  value={(ov as TextOverlay).align}
                  onChange={(e) =>
                    ed.updateOverlay(ov.id, { align: e.target.value as TextOverlay["align"] } as Partial<TextOverlay>)
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <div className="ed-field d-flex align-items-center gap-2">
                <input
                  type="checkbox"
                  checked={(ov as TextOverlay).bgEnabled}
                  onChange={(e) =>
                    ed.updateOverlay(
                      ov.id,
                      {
                        bgEnabled: e.target.checked,
                        bg: e.target.checked ? ((ov as TextOverlay).bg !== "transparent" ? (ov as TextOverlay).bg : "#000000") : "transparent",
                      } as Partial<TextOverlay>,
                    )
                  }
                />
                <label style={{ marginBottom: 0 }}>Background</label>
              </div>
              {(ov as TextOverlay).bgEnabled && (
                <div className="ed-field">
                  <label>Background color</label>
                  <input
                    className="ed-input"
                    type="color"
                    value={(ov as TextOverlay).bg !== "transparent" ? (ov as TextOverlay).bg : "#000000"}
                    onChange={(e) => ed.updateOverlay(ov.id, { bg: e.target.value } as Partial<TextOverlay>)}
                  />
                </div>
              )}
            </>
          )}
          {ov.type === "blur" && (
            <div className="ed-field">
              <label>Blur strength — {(ov as BlurOverlay).amount}px</label>
              <input
                type="range"
                min={2}
                max={60}
                className="w-100"
                value={(ov as BlurOverlay).amount}
                onChange={(e) => ed.updateOverlay(ov.id, { amount: Number(e.target.value) } as Partial<BlurOverlay>)}
              />
            </div>
          )}
          <div className="d-flex">
            <div className="ed-field flex-fill">
              <label>Start (s)</label>
              <input
                className="ed-input"
                type="number"
                step={0.1}
                value={ov.start.toFixed(2)}
                onChange={(e) => ed.updateOverlay(ov.id, { start: Math.max(0, Number(e.target.value)) })}
              />
            </div>
            <div className="ed-field flex-fill">
              <label>End (s)</label>
              <input
                className="ed-input"
                type="number"
                step={0.1}
                value={ov.end.toFixed(2)}
                onChange={(e) => ed.updateOverlay(ov.id, { end: Math.max(ov.start + 0.1, Number(e.target.value)) })}
              />
            </div>
          </div>
          <div className="ed-field">
            <button className="ed-btn danger w-100" onClick={() => ed.removeOverlay(ov.id)}>
              🗑 Remove overlay
            </button>
          </div>
          <div className="ed-field" style={{ color: "var(--ed-muted)", fontSize: 11 }}>
            Tip: drag the box on the preview to reposition, use the corner handle to resize.
          </div>
        </>
      )}
      <div
        style={{
          marginTop: "auto",
          padding: "12px 12px 16px",
          borderTop: "1px solid var(--ed-line)",
          color: "#ffffff",
          fontSize: 11,
          letterSpacing: 0.2,
          textAlign: "center",
          fontWeight: 500,
        }}
      >
        Powered by Nirvaan Technologies
      </div>
    </aside>
  );
}
