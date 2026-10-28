import { useEffect, useRef } from "react";
import { getEngine } from "../../engine/audioEngine";
import { useUIStore } from "../../stores/uiStore";
import { usePlayerStore } from "../../stores/playerStore";

interface VisualizerProps {
  bars?: number;
  className?: string;
  /** When false, renders a flat baseline (still mounted). */
  active?: boolean;
}

/**
 * Canvas frequency visualizer fed by the engine's AnalyserNode.
 * Single rAF loop; honors prefers-reduced-motion; cleans up fully.
 */
export function Visualizer({ bars = 40, className = "", active = true }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizerOn = useUIStore((s) => s.visualizerOn);
  const theme = useUIStore((s) => s.theme);
  const artwork = usePlayerStore((s) => s.current?.artwork_best ?? s.current?.artwork);

  useEffect(() => {
    if (!visualizerOn || !active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion =
      typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let stopped = false;
    let idlePhase = 0;

    const draw = () => {
      if (stopped) return;
      raf = requestAnimationFrame(draw);

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const styles = getComputedStyle(canvas);
      const accent = styles.getPropertyValue("--art-1").trim() || styles.getPropertyValue("--accent").trim() || "#8b6cff";
      const accent2 = styles.getPropertyValue("--art-2").trim() || styles.getPropertyValue("--accent-2").trim() || "#4dd0ff";

      const data = getEngine().getFrequencyData();
      const gap = 3;
      const barW = Math.max(2, (w - gap * (bars - 1)) / bars);
      idlePhase += 0.03;

      for (let i = 0; i < bars; i++) {
        let v: number;
        if (data && data.length > 0) {
          // Spread analyser bins across the bar count.
          const idx = Math.floor((i / bars) * data.length);
          v = (data[idx] ?? 0) / 255;
        } else {
          v = 0.12 + 0.08 * Math.sin(idlePhase + i * 0.45);
        }
        if (reduceMotion) v = Math.max(v, 0.18);
        const barH = Math.max(3, v * h * 0.95);
        const x = i * (barW + gap);
        const y = h - barH;
        const grad = ctx.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, accent);
        grad.addColorStop(1, accent2);
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.4 + v * 0.6;
        ctx.beginPath();
        const r = Math.min(barW / 2, 3);
        ctx.roundRect(x, y, barW, barH, [r, r, 0, 0]);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [visualizerOn, active, theme, artwork, bars]);

  if (!visualizerOn) return null;
  return <canvas ref={canvasRef} aria-hidden className={`h-full w-full ${className}`} />;
}
