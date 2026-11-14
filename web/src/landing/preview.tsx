// DEV-ONLY preview harness for the landing (open /landing-preview.html). Not part of the app build.
//
// MOCK: the props are built here, in the harness, by preview-props.ts from the real cached files with the analysis
// module. In the app, App.tsx owns this computation; the landing components only render props.
//   ?story=null   loading state: manifest only, story/replay null, every point's result/strip null
//   ?delay=1500   loading state first, then the data after that many milliseconds (checks for layout shift)
// Callbacks only log and show a toast, so CTA wiring is visible without the router.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../styles.css";
import { Landing } from "./index";
import { buildMockProps, type MockData } from "./preview-props";

const params = new URLSearchParams(location.search);
const loadingOnly = params.get("story") === "null";
const delay = Number(params.get("delay") ?? 0);

function Harness() {
  const [data, setData] = useState<MockData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (loadingOnly || delay > 0) {
        const loading = await buildMockProps(true);
        if (alive) setData(loading);
        if (loadingOnly) return;
        await new Promise((r) => setTimeout(r, delay));
      }
      const full = await buildMockProps(false);
      if (alive) setData(full);
    })().catch((e: unknown) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const call = (what: string) => () => {
    console.log(`[preview] ${what}`);
    setToast(what);
    window.setTimeout(() => setToast(null), 1600);
  };

  if (error) return <pre style={{ padding: 24 }}>Preview could not load the cached data: {error}</pre>;
  if (!data) return null;
  return (
    <>
      <Landing
        {...data}
        onTryDemo={call("onTryDemo")}
        onOpenCalendar={call("onOpenCalendar")}
        onOpenTool={call("onOpenTool")}
        onAssumptions={call("onAssumptions")}
      />
      <div
        role="status"
        data-testid="preview-toast"
        style={{
          position: "fixed", left: 16, bottom: 16, zIndex: 100, padding: "8px 12px", borderRadius: 6,
          background: "#f1f2ee", color: "#0a0b0d", font: "600 13px var(--font-mono)",
          opacity: toast ? 1 : 0, pointerEvents: "none",
        }}
      >
        {toast ? `MOCK callback: ${toast}` : ""}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
