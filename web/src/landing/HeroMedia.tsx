import { Pause, Play } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { MEDIA } from "./media";

const POSTER = MEDIA.heroPoster;
const VIDEO = MEDIA.heroVideo;

export function HeroMedia() {
  const [stillOk, setStillOk] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setMotionAllowed(!query.matches);
      setVideoReady(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else
      void video.play().catch((e: unknown) => {
        // A pause pressed while play() is pending rejects with AbortError: not a failure, keep the controls.
        if ((e as { name?: string } | null)?.name !== "AbortError") setVideoReady(false);
      });
  }, [paused, motionAllowed]);

  // A cached image can finish before React attaches onLoad; check once after mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setStillOk(true);
  }, []);

  return (
    <>
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
        {motionAllowed && (
          <video
            ref={videoRef}
            className="lw-media-layer"
            data-ready={videoReady}
            src={VIDEO}
            poster={POSTER}
            autoPlay
            muted
            loop
            playsInline
            onPlaying={() => setVideoReady(true)}
            onError={() => setVideoReady(false)}
          />
        )}
        <div className="lw-media-scrim" />
      </div>
      {motionAllowed && videoReady && (
        <button type="button" className="lw-media-toggle" onClick={() => setPaused(!paused)}>
          {paused ? <Play size={14} weight="fill" aria-hidden="true" /> : <Pause size={14} weight="fill" aria-hidden="true" />}
          {paused ? "Play animation" : "Pause animation"}
        </button>
      )}
    </>
  );
}
