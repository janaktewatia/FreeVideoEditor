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
        {busy ? "Importing..." : "⬆ Drop video, MP3/audio or photos here (or click to import)"}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*,.mp3,image/*"
        multiple
        hidden
        onChange={(e) => e.target.files && void handleFiles(e.target.files)}
      />

      {ed.media.length === 0 && <div className="ed-empty">No media yet. Import video, music or photos to start editing.</div>}

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
              {m.kind.toUpperCase()} · {m.duration.toFixed(1)}s
              {m.width > 0 && m.height > 0 ? ` · ${m.width}x${m.height}` : ""}
            </div>
            {m.kind !== "audio" && (
              <button
                className="ed-btn"
                style={{ padding: "2px 6px", fontSize: 11, marginTop: 4 }}
                onClick={(e) => {
                  e.stopPropagation();
                  ed.addMediaOverlay(m.id, ed.playhead);
                }}
                title="Add as PIP overlay"
              >
                Add as PIP
              </button>
            )}
          </div>
        </div>
      ))}
    </aside>
  );
}
