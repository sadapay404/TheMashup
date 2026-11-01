import type { ThemeId } from "./types";

export type Theme = {
  id: ThemeId;
  name: string;
  tagline: string;
  dark: boolean;
  bg: string;
  surface: string;
  raised: string;
  text: string;
  muted: string;
  subtle: string;
  accent: string;
  accent2: string;
  accentText: string;
  outline: string;
  /** page background image (gradients) */
  backdrop: string;
};

export const THEMES: Theme[] = [
  {
    id: "frosted",
    name: "Frosted Glass",
    tagline: "Dark · Glass",
    dark: true,
    bg: "#0A0A0F",
    surface: "#15151F",
    raised: "#1D1D2A",
    text: "#F4F4F8",
    muted: "#A8A8BC",
    subtle: "#74748A",
    accent: "#9B80FF",
    accent2: "#6C9BFF",
    accentText: "#0B0B12",
    outline: "#2C2C3B",
    backdrop:
      "radial-gradient(900px 500px at 15% -10%, rgba(155,128,255,.22), transparent 60%), radial-gradient(700px 500px at 100% 10%, rgba(108,155,255,.12), transparent 60%)",
  },
  {
    id: "paper",
    name: "Paper & Ink",
    tagline: "Light · Typographic",
    dark: false,
    bg: "#F6F1E7",
    surface: "#ECE5D6",
    raised: "#FBF8F1",
    text: "#1E1A16",
    muted: "#5E554A",
    subtle: "#8C8274",
    accent: "#B3441F",
    accent2: "#7A5C3E",
    accentText: "#FFF8F0",
    outline: "#D5CAB4",
    backdrop: "none",
  },
  {
    id: "neon",
    name: "Neon Cyber",
    tagline: "Dark · Electric",
    dark: true,
    bg: "#070B12",
    surface: "#1B4742",
    raised: "#245A54",
    text: "#E8FFF9",
    muted: "#8FC9BE",
    subtle: "#5E9188",
    accent: "#00DDB0",
    accent2: "#FF3EC8",
    accentText: "#04100D",
    outline: "#2E6A62",
    backdrop:
      "radial-gradient(700px 420px at 90% -5%, rgba(255,62,200,.20), transparent 60%), radial-gradient(800px 500px at 0% 0%, rgba(0,221,176,.20), transparent 60%)",
  },
  {
    id: "aurora",
    name: "Aurora",
    tagline: "Dark · Atmospheric",
    dark: true,
    bg: "#101A36",
    surface: "#2B3E68",
    raised: "#36508A",
    text: "#EAF2FF",
    muted: "#A9BCE0",
    subtle: "#7C90B8",
    accent: "#6EE7FF",
    accent2: "#B490FF",
    accentText: "#06121F",
    outline: "#44598A",
    backdrop:
      "radial-gradient(900px 500px at 10% -10%, rgba(110,231,255,.22), transparent 60%), radial-gradient(800px 600px at 100% 20%, rgba(180,144,255,.25), transparent 60%)",
  },
  {
    id: "vinyl",
    name: "Vinyl",
    tagline: "Warm · Retro",
    dark: true,
    bg: "#221A14",
    surface: "#48392C",
    raised: "#574536",
    text: "#F7EBDD",
    muted: "#C9B49C",
    subtle: "#99856F",
    accent: "#E8A33D",
    accent2: "#BD5959",
    accentText: "#1E1408",
    outline: "#62503E",
    backdrop:
      "radial-gradient(800px 500px at 50% -20%, rgba(232,163,61,.22), transparent 60%), radial-gradient(600px 400px at 100% 100%, rgba(189,89,89,.15), transparent 60%)",
  },
];

export const DEFAULT_THEME: ThemeId = "frosted";

export function themeCss(): string {
  return THEMES.map(
    (t) =>
      `[data-theme="${t.id}"]{--bg:${t.bg};--surface:${t.surface};--raised:${t.raised};--text:${t.text};--muted:${t.muted};--subtle:${t.subtle};--accent:${t.accent};--accent2:${t.accent2};--accent-ink:${t.accentText};--outline:${t.outline};--backdrop:${t.backdrop};color-scheme:${t.dark ? "dark" : "light"}}`,
  ).join("\n");
}
