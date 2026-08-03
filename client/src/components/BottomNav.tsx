import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

const ACTIVE = "#ffffff";
const DIM = "rgba(255,255,255,0.38)";

const HomeIcon = ({ active, c }: { active: boolean; c: string }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
    {active ? (
      <>
        <path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5Z" fill={c} opacity="0.15"/>
        <path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round"/>
        <circle cx="12" cy="12" r="2.5" fill={c}/>
        <circle cx="12" cy="12" r="4.5" stroke={c} strokeWidth="1.2" opacity="0.4"/>
      </>
    ) : (
      <>
        <path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round"/>
        <circle cx="12" cy="12" r="2" fill={c} opacity="0.6"/>
      </>
    )}
  </svg>
);

const TasksIcon = ({ active, c }: { active: boolean; c: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    {active ? (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" fill={c} opacity="0.15"/>
        <rect x="3" y="4" width="18" height="16" rx="3" stroke={c} strokeWidth="1.8"/>
        <path d="M8 9h8M8 13h5M8 17h3" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
      </>
    ) : (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" stroke={c} strokeWidth="1.8"/>
        <path d="M8 9h8M8 13h5M8 17h3" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
      </>
    )}
  </svg>
);

const FriendsIcon = ({ active, c }: { active: boolean; c: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    {active ? (
      <>
        <circle cx="9" cy="7" r="4" fill={c} opacity="0.2" stroke={c} strokeWidth="1.8"/>
        <path d="M3 21c0-3.866 2.686-7 6-7s6 3.134 6 7" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M21 21c0-3.866-1.79-7-4-7" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
      </>
    ) : (
      <>
        <circle cx="9" cy="7" r="4" stroke={c} strokeWidth="1.8"/>
        <path d="M3 21c0-3.866 2.686-7 6-7s6 3.134 6 7" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M21 21c0-3.866-1.79-7-4-7" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
      </>
    )}
  </svg>
);

const TABS = [
  { id: "earn",   label: "Tasks",   path: "/earn",   },
  { id: "game",   label: "Home",    path: "/game",   },
  { id: "friend", label: "Friends", path: "/friend", },
] as const;

export default function BottomNav() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [badgeCount, setBadgeCount] = useState(0);

  useEffect(() => {
    async function fetchBadge() {
      try {
        // First check cached user data for instant render
        const cachedUser = queryClient.getQueryData<any>(['/api/auth/user']);
        const axnClaimed = cachedUser?.axnNameRewardClaimed ?? true;
        const quickCount = axnClaimed ? 0 : 1;
        if (quickCount > 0) setBadgeCount(quickCount);

        // Then fetch the full count from server
        const res = await fetch('/api/tasks/badge-count', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.count === 'number') setBadgeCount(data.count);
        }
      } catch {
        // ignore
      }
    }

    fetchBadge();
    const interval = setInterval(fetchBadge, 60000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const isOn = (tab: typeof TABS[number]) =>
    location === tab.path || (tab.id === "game" && (location === "/" || location.startsWith("/game")));

  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 600,
      display: "flex", alignItems: "stretch",
      height: 72,
      paddingBottom: "max(var(--tg-content-safe-area-inset-bottom, var(--tg-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))), 6px)",
      background: "#0a0a0a",
    }}>
      {TABS.map((tab) => {
        const on = isOn(tab);
        const c = on ? ACTIVE : DIM;
        const showBadge = tab.id === "earn" && badgeCount > 0 && !on;

        return (
          <button
            key={tab.id}
            onClick={() => setLocation(tab.path)}
            style={{
              flex: 1, height: "100%", border: "none", background: "transparent",
              cursor: "pointer", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: 5, touchAction: "manipulation", position: "relative",
              padding: "6px 0 4px",
            }}
          >
            {on && (
              <div style={{
                position: "absolute", top: 0, left: "25%", right: "25%",
                height: 2, borderRadius: "0 0 3px 3px",
                background: ACTIVE,
              }} />
            )}

            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 40, height: 30, position: "relative",
            }}>
              {tab.id === "game"   && <HomeIcon    active={on} c={c} />}
              {tab.id === "earn"   && <TasksIcon   active={on} c={c} />}
              {tab.id === "friend" && <FriendsIcon active={on} c={c} />}

              {showBadge && (
                <div style={{
                  position: "absolute", top: -2, right: 2,
                  minWidth: 16, height: 16,
                  background: "#ef4444",
                  borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "0 4px",
                  border: "1.5px solid #0a0a0a",
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, color: "#fff",
                    lineHeight: 1, letterSpacing: "-0.3px",
                  }}>
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                </div>
              )}
            </div>

            <span style={{
              fontSize: 10, fontWeight: on ? 700 : 500,
              letterSpacing: "0.03em",
              color: c,
              lineHeight: 1,
            }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
