import { useEffect, useRef, useState } from "react";

// Illustrative background for the hero comparison (a still; no loop video ships). The file is optional: until it
// has actually loaded, the CSS terrain fallback underneath is what shows, and a file that fails is never displayed.
// A still never moves, so it is also what prefers-reduced-motion users get.

const POSTER = `${import.meta.env.BASE_URL}media/hero-poster.jpg`;

export function HeroMedia() {
  const [stillOk, setStillOk] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // A cached image can finish before React attaches onLoad; check once after mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setStillOk(true);
  }, []);

  return (
    <div className="lw-media" aria-hidden="true">
      <div className="lw-media-fallback">
        <span className="lw-media-sun" />
        <span className="lw-media-ridge lw-media-ridge-far" />
        <span className="lw-media-ridge lw-media-ridge-near" />
      </div>
      <img
        ref={imgRef}
        className="lw-media-layer"
        data-ready={stillOk}
        src={POSTER}
        alt=""
        decoding="async"
        fetchPriority="high"
        onLoad={(e) => setStillOk(e.currentTarget.naturalWidth > 0)}
        onError={() => setStillOk(false)}
      />
      <div className="lw-media-scrim" />
    </div>
  );
}
