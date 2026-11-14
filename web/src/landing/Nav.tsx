import { ArrowRight } from "@phosphor-icons/react";

export const NAV_LINKS = [
  { id: "why", label: "Why a day matters" },
  { id: "features", label: "What you can do" },
  { id: "points", label: "The three points" },
  { id: "data", label: "Data and limits" },
] as const;

/** Scrolls a section into view and moves focus to its heading (the hash belongs to the router, so no href="#id"). */
export function goToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const heading = el.querySelector<HTMLElement>("h2");
  if (heading) {
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

/** Wordmark: a disc sitting on a horizon line. Pure geometry, decorative. */
export function Mark() {
  return (
    <svg className="lw-mark" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.5" cy="10.5" r="3.25" fill="var(--lw-sun)" />
      <rect x="1.75" y="13.25" width="20.5" height="1.5" fill="currentColor" />
    </svg>
  );
}

export function Nav({ solid, onOpenTool }: { solid: boolean; onOpenTool: () => void }) {
  return (
    <header className="lw-nav" data-solid={solid}>
      <div className="lw-wrap lw-nav-inner">
        <span className="lw-wordmark">
          <Mark />
          LunaWindow
        </span>
        <nav className="lw-nav-links" aria-label="On this page">
          {NAV_LINKS.map((l) => (
            <button key={l.id} type="button" className="lw-nav-link" onClick={() => goToSection(l.id)}>
              {l.label}
            </button>
          ))}
        </nav>
        <button type="button" className="lw-btn lw-btn-primary lw-btn-sm" onClick={onOpenTool}>
          Open the navigator
          <ArrowRight size={16} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
