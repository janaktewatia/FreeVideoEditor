import { useEditor } from "@/editor/store";
import { clipDuration, type TextOverlay, type BlurOverlay, type ShapeOverlay, type ZoomOverlay, type MediaOverlay } from "@/editor/types";

export default function Inspector() {
  const ed = useEditor();
  const sel = ed.selectedClip;
  const ov = ed.selectedOverlay;
  const selAsset = sel ? ed.media.find((m) => m.id === sel.clip.mediaId) : null;
  const isAudio = selAsset?.kind === "audio";
  const isVisual = selAsset?.kind === "video" || selAsset?.kind === "image";

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
              value={sel.clip.start}
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
                value={sel.clip.in}
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
                value={sel.clip.out}
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
          {isVisual && (
            <>
              <div className="ed-field">
                <label>Transition</label>
                <select
                  className="ed-select"
                  value={sel.clip.transition}
                  onChange={(e) => ed.updateClip(sel.clip.id, { transition: e.target.value as typeof sel.clip.transition })}
                >
                  <option value="none">Cut</option>
                  <option value="fade">Fade in</option>
                  <option value="slide">Slide in</option>
                  <option value="zoom">Zoom in</option>
                </select>
              </div>
              <div className="ed-field">
                <label>Transition duration (s)</label>
                <input
                  className="ed-input"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={sel.clip.transitionDuration}
                  onChange={(e) =>
                    ed.updateClip(sel.clip.id, {
                      transitionDuration: Math.max(0, Math.min(2, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>
            </>
          )}
          {!isAudio && (
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
          )}
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
            <>
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
              <div className="d-flex">
                <div className="ed-field flex-fill">
                  <label>Width %</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={5}
                    max={100}
                    step={1}
                    value={Math.round((ov as BlurOverlay).w * 100)}
                    onChange={(e) =>
                      ed.updateOverlay(
                        ov.id,
                        { w: Math.max(0.05, Math.min(1, Number(e.target.value) / 100)) } as Partial<BlurOverlay>,
                      )
                    }
                  />
                </div>
                <div className="ed-field flex-fill">
                  <label>Height %</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={5}
                    max={100}
                    step={1}
                    value={Math.round((ov as BlurOverlay).h * 100)}
                    onChange={(e) =>
                      ed.updateOverlay(
                        ov.id,
                        { h: Math.max(0.05, Math.min(1, Number(e.target.value) / 100)) } as Partial<BlurOverlay>,
                      )
                    }
                  />
                </div>
              </div>
              <div className="d-flex gap-2">
                <div className="ed-field" style={{ width: 120, minWidth: 120, flex: "0 0 120px" }}>
                  <label>Tint color</label>
                  <input
                    className="ed-input"
                    type="color"
                    value={(ov as BlurOverlay).color ?? "#000000"}
                    onChange={(e) => ed.updateOverlay(ov.id, { color: e.target.value } as Partial<BlurOverlay>)}
                    style={{ minHeight: 34, width: "100%", padding: 0, borderRadius: 6 }}
                  />
                </div>
                <div className="ed-field flex-fill">
                  <label>Tint opacity — {Math.round(((ov as BlurOverlay).opacity ?? 0) * 100)}%</label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    className="w-100"
                    value={(ov as BlurOverlay).opacity ?? 0}
                    onChange={(e) =>
                      ed.updateOverlay(
                        ov.id,
                        { opacity: Math.max(0, Math.min(1, Number(e.target.value))) } as Partial<BlurOverlay>,
                      )
                    }
                  />
                </div>
              </div>
            </>
          )}
          {ov.type === "shape" && (
            <>
              <div className="ed-field">
                <label>Shape type</label>
                <select
                  className="ed-select"
                  value={(ov as ShapeOverlay).shape}
                  onChange={(e) =>
                    ed.updateOverlay(ov.id, { shape: e.target.value as ShapeOverlay["shape"] } as Partial<ShapeOverlay>)
                  }
                >
                  <option value="rect">Square / Rect</option>
                  <option value="circle">Circle</option>
                  <option value="line">Line</option>
                  <option value="arrow">Arrow</option>
                </select>
              </div>
              <div className="d-flex">
                <div className="ed-field flex-fill">
                  <label>Width %</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={Math.round((ov as ShapeOverlay).w * 100)}
                    onChange={(e) =>
                      ed.updateOverlay(ov.id, { w: Math.max(0.01, Math.min(1, Number(e.target.value) / 100)) } as Partial<ShapeOverlay>)
                    }
                  />
                </div>
                <div className="ed-field flex-fill">
                  <label>Height %</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={Math.round((ov as ShapeOverlay).h * 100)}
                    onChange={(e) =>
                      ed.updateOverlay(ov.id, { h: Math.max(0.01, Math.min(1, Number(e.target.value) / 100)) } as Partial<ShapeOverlay>)
                    }
                  />
                </div>
              </div>
              <div className="d-flex gap-2">
                <div className="ed-field" style={{ width: 110, minWidth: 110, flex: "0 0 110px" }}>
                  <label>Color</label>
                  <input
                    className="ed-input"
                    type="color"
                    value={(ov as ShapeOverlay).color}
                    onChange={(e) => ed.updateOverlay(ov.id, { color: e.target.value } as Partial<ShapeOverlay>)}
                    style={{ minHeight: 34, width: "100%", padding: 0, borderRadius: 6 }}
                  />
                </div>
                <div className="ed-field flex-fill">
                  <label>Stroke width</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={1}
                    max={24}
                    step={1}
                    value={(ov as ShapeOverlay).strokeWidth}
                    onChange={(e) =>
                      ed.updateOverlay(
                        ov.id,
                        { strokeWidth: Math.max(1, Math.min(24, Number(e.target.value) || 1)) } as Partial<ShapeOverlay>,
                      )
                    }
                  />
                </div>
              </div>
              <div className="ed-field d-flex align-items-center gap-2">
                <input
                  type="checkbox"
                  checked={(ov as ShapeOverlay).fill}
                  onChange={(e) => ed.updateOverlay(ov.id, { fill: e.target.checked } as Partial<ShapeOverlay>)}
                />
                <label style={{ marginBottom: 0 }}>Fill shape</label>
              </div>
              {(ov as ShapeOverlay).fill && (
                <div className="ed-field">
                  <label>Fill opacity — {Math.round((ov as ShapeOverlay).fillOpacity * 100)}%</label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    className="w-100"
                    value={(ov as ShapeOverlay).fillOpacity}
                    onChange={(e) =>
                      ed.updateOverlay(
                        ov.id,
                        { fillOpacity: Math.max(0, Math.min(1, Number(e.target.value))) } as Partial<ShapeOverlay>,
                      )
                    }
                  />
                </div>
              )}
            </>
          )}
          {ov.type === "zoom" && (
            <>
              <div className="d-flex">
                <div className="ed-field flex-fill">
                  <label>Zoom area width %</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={5}
                    max={100}
                    step={1}
                    value={Math.round((ov as ZoomOverlay).w * 100)}
                    onChange={(e) =>
                      ed.updateOverlay(
                        ov.id,
                        { w: Math.max(0.05, Math.min(1, Number(e.target.value) / 100)) } as Partial<ZoomOverlay>,
                      )
                    }
                  />
                </div>
                <div className="ed-field flex-fill">
                  <label>Zoom area height %</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={5}
                    max={100}
                    step={1}
                    value={Math.round((ov as ZoomOverlay).h * 100)}
                    onChange={(e) =>
                      ed.updateOverlay(
                        ov.id,
                        { h: Math.max(0.05, Math.min(1, Number(e.target.value) / 100)) } as Partial<ZoomOverlay>,
                      )
                    }
                  />
                </div>
              </div>
              <div className="ed-field">
                <label>Zoom scale</label>
                <input
                  className="ed-input"
                  type="number"
                  min={1.1}
                  max={4}
                  step={0.1}
                  value={(ov as ZoomOverlay).scale}
                  onChange={(e) =>
                    ed.updateOverlay(
                      ov.id,
                      { scale: Math.max(1.1, Math.min(4, Number(e.target.value) || 1.1)) } as Partial<ZoomOverlay>,
                    )
                  }
                />
              </div>
              <div className="ed-field">
                <label>Zoom style</label>
                <select
                  className="ed-select"
                  value={(ov as ZoomOverlay).mode ?? "focus"}
                  onChange={(e) => ed.updateOverlay(ov.id, { mode: e.target.value as ZoomOverlay["mode"] } as Partial<ZoomOverlay>)}
                >
                  <option value="focus">Focus point (selected box)</option>
                  <option value="center">Center zoom</option>
                </select>
              </div>
              <div className="ed-field">
                <label>Smoothness — {Math.round(((ov as ZoomOverlay).smoothness ?? 0.75) * 100)}%</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  className="w-100"
                  value={(ov as ZoomOverlay).smoothness ?? 0.75}
                  onChange={(e) =>
                    ed.updateOverlay(
                      ov.id,
                      { smoothness: Math.max(0, Math.min(1, Number(e.target.value))) } as Partial<ZoomOverlay>,
                    )
                  }
                />
              </div>
              <div className="d-flex">
                <div className="ed-field flex-fill">
                  <label>Zoom in duration (sec)</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={(ov as ZoomOverlay).zoomInDuration ?? 0.8}
                    onChange={(e) => {
                      const dur = Math.max(0.2, ov.end - ov.start);
                      const maxIn = Math.max(0.1, dur - 0.1);
                      const nextIn = Math.max(0.1, Math.min(maxIn, Number(e.target.value) || 0.8));
                      const curOut = (ov as ZoomOverlay).zoomOutDuration ?? 0.8;
                      const nextOut = Math.min(curOut, Math.max(0.1, dur - nextIn));
                      ed.updateOverlay(ov.id, { zoomInDuration: nextIn, zoomOutDuration: nextOut } as Partial<ZoomOverlay>);
                    }}
                  />
                </div>
                <div className="ed-field flex-fill">
                  <label>Zoom out duration (sec)</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={(ov as ZoomOverlay).zoomOutDuration ?? 0.8}
                    onChange={(e) => {
                      const dur = Math.max(0.2, ov.end - ov.start);
                      const maxOut = Math.max(0.1, dur - 0.1);
                      const nextOut = Math.max(0.1, Math.min(maxOut, Number(e.target.value) || 0.8));
                      const curIn = (ov as ZoomOverlay).zoomInDuration ?? 0.8;
                      const nextIn = Math.min(curIn, Math.max(0.1, dur - nextOut));
                      ed.updateOverlay(ov.id, { zoomOutDuration: nextOut, zoomInDuration: nextIn } as Partial<ZoomOverlay>);
                    }}
                  />
                </div>
              </div>
            </>
          )}
          {ov.type === "media" && (
            <>
              <div className="ed-field">
                <label>PIP media</label>
                <select
                  className="ed-select"
                  value={(ov as MediaOverlay).mediaId}
                  onChange={(e) => ed.updateOverlay(ov.id, { mediaId: e.target.value } as Partial<MediaOverlay>)}
                >
                  {ed.media
                    .filter((m) => m.kind !== "audio")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="d-flex">
                <div className="ed-field flex-fill">
                  <label>Width %</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={5}
                    max={100}
                    step={1}
                    value={Math.round((ov as MediaOverlay).w * 100)}
                    onChange={(e) =>
                      ed.updateOverlay(
                        ov.id,
                        { w: Math.max(0.05, Math.min(1, Number(e.target.value) / 100)) } as Partial<MediaOverlay>,
                      )
                    }
                  />
                </div>
                <div className="ed-field flex-fill">
                  <label>Height %</label>
                  <input
                    className="ed-input"
                    type="number"
                    min={5}
                    max={100}
                    step={1}
                    value={Math.round((ov as MediaOverlay).h * 100)}
                    onChange={(e) =>
                      ed.updateOverlay(
                        ov.id,
                        { h: Math.max(0.05, Math.min(1, Number(e.target.value) / 100)) } as Partial<MediaOverlay>,
                      )
                    }
                  />
                </div>
              </div>
              <div className="ed-field">
                <label>Opacity — {Math.round((ov as MediaOverlay).opacity * 100)}%</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  className="w-100"
                  value={(ov as MediaOverlay).opacity}
                  onChange={(e) =>
                    ed.updateOverlay(
                      ov.id,
                      { opacity: Math.max(0, Math.min(1, Number(e.target.value))) } as Partial<MediaOverlay>,
                    )
                  }
                />
              </div>
              <div className="ed-field">
                <label>Corner radius (px)</label>
                <input
                  className="ed-input"
                  type="number"
                  min={0}
                  max={60}
                  step={1}
                  value={(ov as MediaOverlay).borderRadius}
                  onChange={(e) =>
                    ed.updateOverlay(
                      ov.id,
                      { borderRadius: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } as Partial<MediaOverlay>,
                    )
                  }
                />
              </div>
            </>
          )}
          <div className="d-flex">
            <div className="ed-field flex-fill">
              <label>Start (s)</label>
              <input
                className="ed-input"
                type="number"
                step={0.1}
                value={ov.start}
                onChange={(e) => ed.updateOverlay(ov.id, { start: Math.max(0, Number(e.target.value)) })}
              />
            </div>
            <div className="ed-field flex-fill">
              <label>End (s)</label>
              <input
                className="ed-input"
                type="number"
                step={0.1}
                value={ov.end}
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
