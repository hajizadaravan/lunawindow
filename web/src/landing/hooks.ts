import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Whether a media query matches. Follows live changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const q = window.matchMedia?.(query);
    if (!q) return;
    const update = () => setMatches(q.matches);
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** True when the OS asks for reduced motion. Follows live changes. */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Calls back with whether the element intersects the viewport (IntersectionObserver, no scroll listener). */
export function useIntersection<T extends Element>(
  onChange: (inView: boolean) => void,
  options: IntersectionObserverInit = {},
) {
  const ref = useRef<T | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const { rootMargin, threshold } = options;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => cb.current(entries[entries.length - 1].isIntersecting), {
      rootMargin,
      threshold,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, threshold]);
  return ref;
}

/** Content width of an element, so SVG graphics draw at real pixel size and their text never scales down. */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth) setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
