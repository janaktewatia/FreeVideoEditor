import { useRef, useState } from "react";
import { useEditor } from "@/editor/store";
import { dragMedia } from "@/editor/dragBus";

export default function MediaBin() {
  const ed = useEditor();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFiles = async (files: FileList | File[]) => {
    setBusy(true);
    const added = await ed.addMedia(files);
    added.forEach((a) => ed.addClip(a));
    setBusy(false);
  };

  return (
    <aside className="ed-side">
      <div className="ed-panel-title">Media Library</div>
      <div
        className="ed-drop"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
      >
        {busy ? "Importing…" : "⬆ Drop video files here or click to import"}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => e.target.files && void handleFiles(e.target.files)}
      />

      {ed.media.length === 0 && <div className="ed-empty">No media yet. Import a clip to start editing.</div>}

      {ed.media.map((m) => (
        <div
          className="ed-media-item"
          key={m.id}
          draggable
          onDragStart={(e) => {
            dragMedia.id = m.id;
            e.dataTransfer.setData("text/x-media-id", m.id);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onDragEnd={() => {
            dragMedia.id = null;
          }}
          onClick={() => ed.addClip(m)}
          title="Click to add, or drag onto a timeline track"
        >
          {m.thumbnail ? (
            <img className="thumb" src={m.thumbnail} alt={m.name} />
          ) : (
            <div className="thumb" />
          )}
          <div style={{ minWidth: 0 }}>
            <div className="text-truncate">{m.name}</div>
            <div style={{ color: "var(--ed-muted)", fontSize: 11 }}>
              {m.duration.toFixed(1)}s · {m.width}×{m.height}
            </div>
          </div>
        </div>
      ))}

      <div className="ed-panel-title">Insert</div>
      <div className="px-2 pb-3 d-grid gap-2">
        <button className="ed-btn" onClick={() => ed.addTextOverlay(ed.playhead)}>
          T Add text at playhead
        </button>
        <button className="ed-btn" onClick={() => ed.addBlurOverlay(ed.playhead)}>
          ◍ Add blur region
        </button>
      </div>
    </aside>
  );
}
