import { useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import type { Track } from "@themashup/shared";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUIStore } from "../../stores/uiStore";

/** Heart toggle — prompts sign-in when no identity. */
export function LikeButton({
  track,
  size = "sm",
  className = "",
}: {
  track: Track;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const liked = useLibraryStore((s) => s.isLiked(track.id));
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const mode = useSessionStore((s) => s.mode);
  const setAuthModalOpen = useUIStore((s) => s.setAuthModalOpen);
  const [busy, setBusy] = useState(false);

  const dim =
    size === "lg" ? "h-7 w-7" : size === "md" ? "h-5 w-5" : "h-4 w-4";
  const pad = size === "lg" ? "p-2.5" : size === "md" ? "p-2" : "p-1.5";

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === "none") {
      setAuthModalOpen(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await toggleLike(track);
    } catch {
      /* rollback handled in store */
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => void onClick(e)}
      title={liked ? "Remove from Liked" : "Save to Liked"}
      aria-pressed={liked}
      className={`rounded-lg transition hover:text-ink ${pad} ${className}`}
    >
      {busy ? (
        <Loader2 className={`${dim} animate-spin text-dim`} />
      ) : (
        <Heart
          className={`${dim} transition ${
            liked ? "scale-110 text-accent" : "text-faint"
          }`}
          fill={liked ? "currentColor" : "none"}
        />
      )}
    </button>
  );
}
