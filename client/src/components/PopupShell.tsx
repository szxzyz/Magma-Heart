import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { CUT_LG, CORNER_ACCENTS_LG, cornerAccentStyle, outerBorderStyle } from "@/lib/cutCorner";

type Props = {
  children: ReactNode;
  onClose: () => void;
  maxWidth?: number;
  zIndex?: number;
  closeOnBackdrop?: boolean;
};

/**
 * Shared modal treatment used by the menu and action popups.
 * Keeping the animation and frame in one place prevents sheets from
 * drifting into different visual styles.
 */
export default function PopupShell({
  children,
  onClose,
  maxWidth = 390,
  zIndex = 1000,
  closeOnBackdrop = true,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
         padding: "max(12px, env(safe-area-inset-left)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom))",
      }}
    >
      <div
        onClick={closeOnBackdrop ? onClose : undefined}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.58)",
           // Avoid backdrop-filter here: it forces an expensive full-screen
           // repaint on lower-end Telegram WebViews.
        }}
      />
      <div style={{ ...outerBorderStyle(maxWidth), position: "relative", zIndex: 1 }}>
        <motion.div
           initial={{ scale: 0.97, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
           exit={{ scale: 0.97, opacity: 0, y: 8 }}
           transition={{ duration: 0.14, ease: "easeOut" }}
          onClick={event => event.stopPropagation()}
          style={{
            position: "relative",
            width: "100%",
             maxHeight: "min(88dvh, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px))",
            overflowY: "auto",
             overscrollBehavior: "contain",
             WebkitOverflowScrolling: "touch",
            background: "#0a0a0a",
            clipPath: CUT_LG,
            padding: "22px 18px max(20px, calc(env(safe-area-inset-bottom, 0px) + 12px))",
          }}
        >
          {CORNER_ACCENTS_LG.map((style, index) => (
            <div key={index} style={{ ...cornerAccentStyle, ...style }} />
          ))}
          {children}
        </motion.div>
      </div>
    </motion.div>
  );
}