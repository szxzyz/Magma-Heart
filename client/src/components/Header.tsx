import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { forwardRef, useImperativeHandle } from "react";
import { Plus } from "lucide-react";
import { TonIcon } from "@/components/TonIcon";
import DepositPopup from "@/components/DepositPopup";

interface HeaderProps {
  onMenuOpen?: () => void;
  onInviteOpen?: () => void;
  onWithdrawOpen?: () => void;
  onSettingsOpen?: () => void;
  onTransactionsOpen?: () => void;
  onPromoOpen?: () => void;
  onShareOpen?: () => void;
}

const Header = forwardRef<HTMLDivElement, HeaderProps>(
  ({ onMenuOpen }, ref) => {
    const [overlayTop, setOverlayTop] = useState(0);
    const [depositOpen, setDepositOpen] = useState(false);
    const innerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => innerRef.current!);

    const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false, staleTime: 0 });

    const gramBalance = parseFloat(user?.balance || '0');

    const firstName: string = user?.firstName || user?.username || "Miner";
    const profileImageUrl: string | null =
      user?.profileImageUrl ||
      (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url) ||
      null;
    const initials = firstName.slice(0, 2).toUpperCase();

    // Real Telegram UID — prefer from Telegram WebApp directly, fallback to DB field
    const tgUid: string | null =
      (typeof window !== "undefined" &&
        (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString()) ||
      user?.telegramId ||
      user?.telegram_id ||
      null;

    useEffect(() => {
      const tg = (window as any).Telegram?.WebApp;
      if (!tg) return;

      const measure = () => {
        const st: number = tg.safeAreaInset?.top ?? 0;
        setOverlayTop(st);
        document.documentElement.style.setProperty('--tg-overlay-top', `${st}px`);
      };

      measure();
      tg.onEvent?.('safeAreaChanged', measure);
      tg.onEvent?.('viewportChanged', measure);

      const interval = setInterval(measure, 150);
      const stop = setTimeout(() => clearInterval(interval), 3000);
      return () => { clearInterval(interval); clearTimeout(stop); };
    }, []);

    useEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      const update = () => {
        const h = el.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--header-height', `${Math.ceil(h)}px`);
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, [overlayTop]);

    return (
      <div
        ref={innerRef}
        className="fixed top-0 left-0 right-0 z-40"
        style={{
          background: "#0a0a0a",
          paddingTop: `${overlayTop + 6}px`,
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px 10px",
          gap: 10,
        }}>

          {/* Left — Profile photo + name + UID */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <button
              onClick={onMenuOpen}
              style={{
                width: 36, height: 36, borderRadius: "50%",
                overflow: "hidden", display: "flex",
                alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                background: "rgba(255,255,255,0.08)",
                border: "1.5px solid rgba(255,255,255,0.12)",
              }}
              className="active:scale-90 transition-transform"
            >
              {profileImageUrl ? (
                <img
                  src={profileImageUrl}
                  alt={firstName}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                    const parent = target.parentElement;
                    if (parent) {
                      const span = document.createElement("span");
                      span.style.cssText = "color:#fff;font-size:13px;font-weight:900;";
                      span.textContent = initials;
                      parent.appendChild(span);
                    }
                  }}
                />
              ) : (
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 900 }}>{initials}</span>
              )}
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
              <span style={{
                color: '#ffffff', fontSize: 14, fontWeight: 700, lineHeight: 1.2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {firstName}
              </span>
              {tgUid && (
                <span style={{
                  color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 500,
                  marginTop: 1, fontFamily: 'monospace', letterSpacing: '0.02em',
                }}>
                  ID: {tgUid}
                </span>
              )}
            </div>
          </div>

          {/* Right — TON payment balance indicator */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 7px 6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 10 }}>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {gramBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </span>
            <TonIcon size={18} />
            <button
              aria-label="Buy with TON"
              onClick={() => setDepositOpen(true)}
              className="active:scale-90 transition-transform"
              style={{
                width: 22, height: 22, borderRadius: 7, border: 'none',
                background: '#2563eb', color: '#fff', display: 'flex',
                alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                marginLeft: 2,
              }}
            >
              <Plus size={15} strokeWidth={2.8} />
            </button>
          </div>

        </div>
        {depositOpen && <DepositPopup onClose={() => setDepositOpen(false)} />}
      </div>
    );
  }
);

Header.displayName = "Header";
export default Header;
