// Hash routing for static hosting (vite base "./"): `#/` is the landing, `#/app` the tool. No router dependency.
import { useEffect, useState } from "react";

export type Route = "landing" | "app";

export const ROUTE_HASH: Record<Route, string> = { landing: "#/", app: "#/app" };

/** Unknown or empty hashes (including in-page anchors such as `#how`) fall back to the landing. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").split(/[?#]/)[0].replace(/\/+$/, "");
  return path === "/app" ? "app" : "landing";
}

export function navigate(route: Route) {
  if (window.location.hash !== ROUTE_HASH[route]) window.location.hash = ROUTE_HASH[route];
}

/** Current route, kept in sync with the address bar (back/forward included). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    // The app resets scroll itself on a route change; the browser's restoration would fight it on back/forward.
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    onChange();
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const ROUTE_TITLE: Record<Route, string> = {
  landing: "LunaWindow: Sun and Earth visibility at lunar south-pole demonstration points",
  app: "Visibility tool · LunaWindow",
};
