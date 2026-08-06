import type { CSSProperties } from "react";

// Shared "menu popup" visual language: cut (chamfered) corners + glowing
// cyan corner-accent ticks. Used across popups, sheets, and cards so they
// all match MenuPopup.tsx.

export const CUT_SM =
  "polygon(8px 0%,calc(100% - 8px) 0%,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0% calc(100% - 8px),0% 8px)";
export const CUT_LG =
  "polygon(14px 0%,calc(100% - 14px) 0%,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0% calc(100% - 14px),0% 14px)";

export const CORNER_ACCENTS_LG: CSSProperties[] = [
  { top: "2px", left: "14px", width: "30px", height: "1.5px" },
  { top: "14px", left: "2px", width: "1.5px", height: "30px" },
  { top: "2px", right: "14px", width: "30px", height: "1.5px" },
  { top: "14px", right: "2px", width: "1.5px", height: "30px" },
  { bottom: "2px", left: "14px", width: "30px", height: "1.5px" },
  { bottom: "14px", left: "2px", width: "1.5px", height: "30px" },
  { bottom: "2px", right: "14px", width: "30px", height: "1.5px" },
  { bottom: "14px", right: "2px", width: "1.5px", height: "30px" },
];

// Smaller accent set for compact cards (task cards, row cards, etc.)
export const CORNER_ACCENTS_SM: CSSProperties[] = [
  { top: "1.5px", left: "8px", width: "16px", height: "1.5px" },
  { top: "8px", left: "1.5px", width: "1.5px", height: "16px" },
  { top: "1.5px", right: "8px", width: "16px", height: "1.5px" },
  { top: "8px", right: "1.5px", width: "1.5px", height: "16px" },
  { bottom: "1.5px", left: "8px", width: "16px", height: "1.5px" },
  { bottom: "8px", left: "1.5px", width: "1.5px", height: "16px" },
  { bottom: "1.5px", right: "8px", width: "16px", height: "1.5px" },
  { bottom: "8px", right: "1.5px", width: "1.5px", height: "16px" },
];

export const cornerAccentStyle: CSSProperties = {
  position: "absolute",
  pointerEvents: "none",
  background: "rgba(0,200,255,0.75)",
  zIndex: 10,
};

// Outer glow-border wrapper style (goes around the CUT_LG inner card)
export function outerBorderStyle(maxWidth = 390): CSSProperties {
  return {
    clipPath: CUT_LG,
    padding: "1.5px",
    background: "rgba(255,255,255,0.08)",
    boxShadow: "0 20px 70px rgba(0,0,0,0.55)",
    width: "100%",
    maxWidth,
  };
}

// Centered backdrop (click to close), replaces bottom-sheet backdrops
export function centeredOverlayStyle(): CSSProperties {
  return {
    position: "fixed", inset: 0, zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
  };
}

export function backdropStyle(): CSSProperties {
  return {
    position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)",
    backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
  };
}
