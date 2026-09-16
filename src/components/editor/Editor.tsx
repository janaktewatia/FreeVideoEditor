import { useEffect, useState } from "react";
import { EditorProvider, useEditor } from "@/editor/store";
import { fmt } from "@/editor/types";
import MediaBin from "./MediaBin";
import Preview from "./Preview";
import Timeline from "./Timeline";
import Inspector from "./Inspector";
import ExportModal from "./ExportModal";

function Transport({ onExport }: { onExport: () => void }) {
  const ed = useEditor();
  const toggle = () => {
    ed.engine.ensureAudio();
    if (ed.playhead >= ed.duration) ed.seek(0);
    ed.setPlaying(!ed.playing);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key.toLowerCase() === "s") ed.splitAt(ed.playhead);
      else if (e.key === "ArrowRight") ed.seek(ed.playhead + (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === "ArrowLeft") ed.seek(ed.playhead - (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === "Delete" && ed.selection?.kind === "clip") ed.removeClip(ed.selection.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });


  return (
    <div className="ed-transport">
      <button className="ed-btn" onClick={ed.undo} disabled={!ed.canUndo} title="Undo (Cmd/Ctrl+Z)">
        ↶ Undo
      </button>
      <button className="ed-btn" onClick={ed.redo} disabled={!ed.canRedo} title="Redo (Cmd/Ctrl+Shift+Z)">
        ↷ Redo
      </button>
      <button className="ed-btn" onClick={() => ed.seek(0)} title="Go to start">
        ⏮
      </button>

      <button className="ed-btn" onClick={() => ed.seek(ed.playhead - 1 / 30)} title="Previous frame">
        ◀
      </button>
      <button className="ed-btn primary" onClick={toggle} style={{ minWidth: 92 }}>
        {ed.playing ? "⏸ Pause" : "▶ Play"}
      </button>
      <button className="ed-btn" onClick={() => ed.seek(ed.playhead + 1 / 30)} title="Next frame">
        ▶
      </button>
      <span className="ed-time ms-2">
        {fmt(ed.playhead)} / {fmt(ed.duration)}
      </span>
      <div className="ms-auto d-flex align-items-center gap-2">
        <button className="ed-btn" onClick={() => ed.addTextOverlay(ed.playhead)}>
          T Text
        </button>
        <button className="ed-btn" onClick={() => ed.addBlurOverlay(ed.playhead)}>
          ◍ Blur
        </button>
        <button className="ed-btn primary" onClick={onExport}>
          ⬇ Export
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    document.body.classList.add("ed-body");
    return () => document.body.classList.remove("ed-body");
  }, []);

  return (
    <div className="ed-app">
      <header className="ed-topbar">
        <div className="ed-brand">
          <span className="dot" />
          Free Video Editor
        </div>
        <div className="ms-auto" style={{ fontSize: 11, color: "var(--ed-muted)" }}>
          Space play/pause · S split · ←/→ step frame · Del remove clip
        </div>
      </header>

      <div className="ed-main">
        <MediaBin />
        <div className="ed-center">
          <Preview />
          <Transport onExport={() => setShowExport(true)} />
          <Timeline />
        </div>
        <Inspector />
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </div>
  );
}

export default function Editor() {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  );
}
