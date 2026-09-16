import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const Editor = lazy(() => import("@/components/editor/Editor"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumen Cut — Browser Video Editor" },
      {
        name: "description",
        content:
          "Split, trim, merge and layer videos on multiple timelines, blur regions, add text, mute audio and export in any format, resolution and frame rate.",
      },
      { property: "og:title", content: "Lumen Cut — Browser Video Editor" },
      {
        property: "og:description",
        content: "A sleek, professional video editor that runs entirely in your browser. No uploads, no accounts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
  ssr: false,
});

function Index() {
  return (
    <Suspense
      fallback={
        <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "#0d1017", color: "#8b97ab" }}>
          Loading editor…
        </div>
      }
    >
      <Editor />
    </Suspense>
  );
}
