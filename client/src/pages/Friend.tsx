import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { FaCrown, FaMedal, FaAward, FaTrophy } from "react-icons/fa";
import Header from "@/components/Header";
import MenuPopup from "@/components/MenuPopup";
import { showNotification } from "@/components/AppNotification";

const CARD = "rgba(255,255,255,0.07)";
const TEXT = "#fff";
const TEXT_DIM = "rgba(255,255,255,0.42)";
const BLUE = "#3b82f6";
const BLUE_D = "#2563eb";

type NftEntry = {
  rank: number;
  username: string | null;
  firstName: string;
  activeNfts: number;
};

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <FaCrown size={18} color="#FFD700" />;
  if (rank === 2) return <FaMedal size={18} color="#C0C0C0" />;
  if (rank === 3) return <FaAward size={18} color="#CD7F32" />;
  return <span style={{ color: TEXT_DIM, fontSize: 12, fontWeight: 800 }}>#{rank}</span>;
}

export default function Friend() {
  const [isSharing, setIsSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], staleTime: 60000 });
  const { data: botInfo } = useQuery<{ username: string }>({ queryKey: ["/api/bot-info"], staleTime: 3600000 });
  const { data: stats } = useQuery<{ friendsInvited: number; commissionEarned: number }>({
    queryKey: ["/api/referrals/stats"],
    staleTime: 15000,
  });
  const { data: leaderboard, isLoading: leaderboardLoading } = useQuery<{
    leaderboard: NftEntry[];
    myRank: NftEntry | null;
  }>({
    queryKey: ["/api/leaderboard/nft-holders"],
    staleTime: 0,
    refetchInterval: 15000,
  });

  const referralLink = user?.referralCode
    ? `https://t.me/${botInfo?.username || "bot"}?start=${user.referralCode}`
    : "";

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    showNotification("Invite link copied!", "success");
  };

  const shareLink = () => {
    if (!referralLink || isSharing) return;
    setIsSharing(true);
    try {
      const url = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("Join Axionet and earn automatic referral rewards!")}`;
      const tg = (window as any).Telegram?.WebApp;
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, "_blank");
    } finally {
      setIsSharing(false);
    }
  };

  const entries = leaderboard?.leaderboard || [];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: TEXT, display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      <Header onMenuOpen={() => setMenuOpen(true)} />
      <main style={{ flex: 1, overflowY: "auto", padding: "calc(var(--header-height, 62px) + 12px) clamp(12px, 4vw, 20px) 96px" }}>
        <section style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.5px" }}>Invite &amp; <span style={{ color: BLUE }}>Earn</span></div>
          <div style={{ color: TEXT_DIM, fontSize: 12, marginTop: 4 }}>Earn automatic rewards from your referred friends.</div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <div style={{ background: CARD, borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
            <div style={{ color: TEXT, fontSize: 22, fontWeight: 900 }}>{stats?.friendsInvited ?? user?.friendsInvited ?? 0}</div>
            <div style={{ color: TEXT_DIM, fontSize: 10, marginTop: 5 }}>Friends Invited</div>
          </div>
          <div style={{ background: CARD, borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
            <div style={{ color: "#4ade80", fontSize: 22, fontWeight: 900 }}>{Math.floor(stats?.commissionEarned ?? 0).toLocaleString()}</div>
            <div style={{ color: TEXT_DIM, fontSize: 10, marginTop: 5 }}>Commission Earned (CIPHER)</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
          <button onClick={copyLink} disabled={!referralLink} style={{ flex: 1, border: "none", borderRadius: 14, padding: "14px 0", color: "#fff", background: "rgba(255,255,255,0.08)", fontWeight: 800, cursor: referralLink ? "pointer" : "not-allowed", opacity: referralLink ? 1 : 0.5 }}>Copy Invite Link</button>
          <button onClick={shareLink} disabled={!referralLink || isSharing} style={{ flex: 1, border: "none", borderRadius: 14, padding: "14px 0", color: "#fff", background: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`, fontWeight: 800, cursor: referralLink ? "pointer" : "not-allowed", boxShadow: "0 4px 18px rgba(37,99,235,0.3)", opacity: referralLink ? 1 : 0.5 }}>
            {isSharing ? "Opening..." : "Share Invite"}
          </button>
        </div>

        <section style={{ background: CARD, borderRadius: 16, padding: "16px 16px 14px", marginBottom: 20 }}>
          <div style={{ color: TEXT, fontSize: 15, fontWeight: 900, marginBottom: 14 }}>Reward Information</div>
          <div style={{ display: "grid", gap: 14, color: TEXT_DIM, fontSize: 12, lineHeight: 1.45 }}>
            <div><strong style={{ color: BLUE }}>Reward Per Friend</strong><br />You receive <strong style={{ color: TEXT }}>1,000 CIPHER</strong> when your referred friend collects <strong style={{ color: TEXT }}>100 AXN</strong>.</div>
            <div><strong style={{ color: BLUE }}>Deposit Commission</strong><br /><strong style={{ color: TEXT }}>+5%</strong> from every deposit made by your referred friends.</div>
            <div><strong style={{ color: BLUE }}>Reward Distribution</strong><br />All referral rewards and deposit commissions are credited automatically. Users do not need to claim them manually.</div>
          </div>
        </section>

        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <FaTrophy size={13} color="#FFD700" />
            <div style={{ color: TEXT, fontSize: 15, fontWeight: 900 }}>Top NFT Holders</div>
          </div>
          {leaderboardLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Loader2 size={22} color="#60a5fa" className="animate-spin" /></div>
          ) : entries.length === 0 ? (
            <div style={{ background: CARD, borderRadius: 14, padding: "32px 20px", textAlign: "center", color: TEXT_DIM, fontSize: 12 }}>No active NFT holders yet.</div>
          ) : (
            <div style={{ background: CARD, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.07)" }}>
              {entries.map((entry) => (
                <div key={`${entry.rank}-${entry.username || entry.firstName}`} style={{ display: "grid", gridTemplateColumns: "38px 1fr auto", gap: 10, alignItems: "center", padding: "13px 15px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "center" }}><RankIcon rank={entry.rank} /></div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: entry.rank <= 3 ? 800 : 600, color: entry.rank <= 3 ? "#facc15" : TEXT }}>
                    {entry.username ? `@${entry.username}` : entry.firstName}
                  </div>
                  <div style={{ color: "#4ade80", fontSize: 13, fontWeight: 800 }}>{entry.activeNfts.toLocaleString()} <span style={{ color: TEXT_DIM, fontSize: 10, fontWeight: 600 }}>NFTs</span></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
    </div>
  );
}