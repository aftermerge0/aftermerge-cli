import { createTheme } from "@/providers/theme-provider";

/** Forge / cooled steel. Copper is the only signature color. */
export const AFTERMERGE_COLORS = {
  bg: "#141210",
  fg: "#e8ddd0",
  muted: "#8a7d70",
  border: "#3d342c",
  accent: "#c4784a",
  danger: "#c45c4a",
  warn: "#c4a04a",
  ok: "#6a9a6a",
  info: "#6a8aaa",
  /** Quiet fill, slightly lifted off bg — not a signature color. */
  well: "#1c1916",
} as const;

export const aftermergeTheme = createTheme({
  name: "aftermerge",
  border: {
    color: AFTERMERGE_COLORS.border,
    focusColor: AFTERMERGE_COLORS.accent,
    style: "single",
  },
  colors: {
    background: AFTERMERGE_COLORS.bg,
    foreground: AFTERMERGE_COLORS.fg,
    muted: AFTERMERGE_COLORS.well,
    mutedForeground: AFTERMERGE_COLORS.muted,
    border: AFTERMERGE_COLORS.border,
    primary: AFTERMERGE_COLORS.fg,
    primaryForeground: AFTERMERGE_COLORS.bg,
    secondary: AFTERMERGE_COLORS.muted,
    secondaryForeground: AFTERMERGE_COLORS.fg,
    accent: AFTERMERGE_COLORS.accent,
    accentForeground: AFTERMERGE_COLORS.bg,
    success: AFTERMERGE_COLORS.ok,
    successForeground: AFTERMERGE_COLORS.bg,
    warning: AFTERMERGE_COLORS.warn,
    warningForeground: AFTERMERGE_COLORS.bg,
    error: AFTERMERGE_COLORS.danger,
    errorForeground: AFTERMERGE_COLORS.fg,
    info: AFTERMERGE_COLORS.info,
    infoForeground: AFTERMERGE_COLORS.fg,
    focusRing: AFTERMERGE_COLORS.accent,
    selection: AFTERMERGE_COLORS.well,
    selectionForeground: AFTERMERGE_COLORS.fg,
  },
});
