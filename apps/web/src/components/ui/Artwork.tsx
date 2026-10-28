import { useState } from "react";

interface ArtworkProps {
  src?: string;
  alt: string;
  className?: string;
  /** Rounded override (defaults to rounded-lg). */
  radius?: string;
}

function hueFrom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

function initials(alt: string): string {
  return alt
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Album art with deterministic gradient fallback when the URL is missing/dead. */
export function Artwork({ src, alt, className = "", radius = "rounded-lg" }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  const showImg = src && !failed;

  if (!showImg) {
    const h = hueFrom(alt || "themashup");
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center font-semibold text-white/90 ${radius} ${className}`}
        style={{
          background: `linear-gradient(135deg, hsl(${h} 65% 52%), hsl(${(h + 48) % 360} 62% 38%))`,
        }}
      >
        <span className="text-[0.7em] tracking-wide">{initials(alt) || "♪"}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${radius} ${className} object-cover`}
    />
  );
}
