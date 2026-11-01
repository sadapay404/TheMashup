"use client";
import { AppProvider } from "@/components/app-context";
import { PlayerProvider } from "@/components/player-context";
import { DownloadsProvider } from "@/components/downloads-context";
import { Shell } from "@/components/shell";

export default function Page() {
  return (
    <AppProvider>
      <DownloadsProvider>
        <PlayerProvider>
          <Shell />
        </PlayerProvider>
      </DownloadsProvider>
    </AppProvider>
  );
}
