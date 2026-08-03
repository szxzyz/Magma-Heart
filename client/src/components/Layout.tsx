import { motion, AnimatePresence } from "framer-motion";

interface LayoutProps {
  children: React.ReactNode;
  hideNav?: boolean;
}

export default function Layout({ children, hideNav }: LayoutProps) {
  return (
    <div
      className="text-foreground font-sans selection:bg-[#4cd3ff]/30 relative"
      style={{
        height: '100dvh',
        width: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: '#050a14',
        /* Background image pinned: bottom of image = character feet, top gets auto-cropped */
        backgroundImage: 'url(/axn-bg.png)',
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        /*
         * calc(100% - var(--char-ground-bottom)):
         *   Places the BOTTOM of the bg image exactly at char feet level.
         *   Extra height is cropped from the TOP → auto-adjusts on every screen size.
         *   Fallback 115px used until JS measures the real feet position.
         */
        backgroundPositionX: 'center',
        backgroundPositionY: 'calc(100% - var(--char-ground-bottom, 115px))',
      }}
    >
      {/* Dark overlay — keeps UI readable while letting background show through */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, rgba(3,7,18,0.72) 0%, rgba(3,7,18,0.45) 50%, rgba(3,7,18,0.28) 80%, rgba(3,7,18,0.55) 100%)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      <AnimatePresence mode="wait">
        <motion.div
          className="relative flex-1 flex flex-col overflow-hidden"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{ flex: 1, minHeight: 0, zIndex: 1 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
