import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChannelJoinPopupProps {
  telegramId: string;
  onVerified: () => void;
}

const CHANNELS = [
  { url: "https://t.me/LightningSatoshi" },
  { url: "https://t.me/Axionetchat" },
];

export default function ChannelJoinPopup({ telegramId, onVerified }: ChannelJoinPopupProps) {
  const queryClient = useQueryClient();
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [joined, setJoined] = useState([false, false]);

  const checkMembership = async (isInitialCheck = false) => {
    if (isChecking) return;
    setIsChecking(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      const tg = window.Telegram?.WebApp;
      if (tg?.initData) headers["x-telegram-data"] = tg.initData;

      const response = await fetch(`/api/check-membership?t=${Date.now()}`, { headers });
      const data = await response.json();

      if (data.success && data.isVerified) {
        onVerified();
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        return;
      }

      if (data.success) {
        setJoined([!!data.channel2Member, !!data.groupMember]);
        if (!isInitialCheck && (!data.channel2Member || !data.groupMember)) {
          setError("Please join all channels to continue.");
        }
      } else if (!isInitialCheck) {
        setError(data.message || "Verification failed. Please try again.");
      }
    } catch {
      if (!isInitialCheck) setError("Failed to check. Please try again.");
    } finally {
      setIsChecking(false);
      setHasInitialized(true);
    }
  };

  useEffect(() => {
    if (!hasInitialized) checkMembership(true);
  }, [telegramId, hasInitialized]);

  const openLink = (url: string) => {
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] flex items-start justify-center px-5"
        style={{ paddingTop: 'calc(var(--header-height, 62px) + 32px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/90 backdrop-blur-md" />

        <motion.div
          className="relative w-full max-w-sm overflow-hidden"
          style={{ background: '#111114', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 28 }}
          initial={{ scale: 0.88, opacity: 0, y: 24 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.88, opacity: 0, y: 24 }}
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
        >
          {/* Top blue glow line */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(96,165,250,0.8), rgba(59,130,246,1), rgba(96,165,250,0.8), transparent)',
            boxShadow: '0 0 20px rgba(59,130,246,0.8)',
          }} />

          {/* Top glow orb */}
          <div style={{
            position: 'absolute', top: -50, left: '50%', transform: 'translateX(-50%)',
            width: 220, height: 90,
            background: 'radial-gradient(ellipse at 50% 100%, rgba(59,130,246,0.28) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          {/* Content */}
          <div style={{ padding: '32px 20px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* 3 JOIN TO ACCESS buttons */}
            {CHANNELS.map((ch, i) => (
              <button
                key={ch.url}
                onClick={() => openLink(ch.url)}
                style={{
                  width: '100%', padding: '16px 0',
                  borderRadius: 50,
                  background: joined[i]
                    ? 'linear-gradient(135deg, #15803d, #22c55e)'
                    : 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  boxShadow: joined[i]
                    ? '0 0 20px rgba(34,197,94,0.35)'
                    : '0 0 20px rgba(59,130,246,0.4)',
                  transition: 'all 0.2s',
                }}
              >
                {/* Paper plane icon */}
                {!joined[i] && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
                {joined[i] && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '0.06em' }}>
                  {joined[i] ? 'JOINED' : 'JOIN TO ACCESS'}
                </span>
              </button>
            ))}

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '8px 14px' }}
                >
                  <p style={{ color: '#f87171', fontSize: 12, textAlign: 'center', fontWeight: 600 }}>{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* I'VE JOINED — VERIFY button */}
            <button
              onClick={() => checkMembership(false)}
              disabled={isChecking}
              style={{
                width: '100%', padding: '16px 0',
                borderRadius: 50,
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.1)',
                cursor: isChecking ? 'not-allowed' : 'pointer',
                opacity: isChecking ? 0.7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                transition: 'all 0.15s',
                marginTop: 2,
              }}
            >
              {isChecking ? (
                <Loader2 style={{ width: 18, height: 18, color: 'rgba(255,255,255,0.5)' }} className="animate-spin" />
              ) : (
                <>
                  <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 700, fontSize: 14, letterSpacing: '0.06em' }}>
                    I'VE JOINED — VERIFY
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </>
              )}
            </button>
          </div>

          {/* Bottom blue glow line */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(96,165,250,0.8), rgba(59,130,246,1), rgba(96,165,250,0.8), transparent)',
            boxShadow: '0 0 20px rgba(59,130,246,0.8)',
          }} />

          {/* Bottom glow orb */}
          <div style={{
            position: 'absolute', bottom: -50, left: '50%', transform: 'translateX(-50%)',
            width: 220, height: 90,
            background: 'radial-gradient(ellipse at 50% 0%, rgba(59,130,246,0.25) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
