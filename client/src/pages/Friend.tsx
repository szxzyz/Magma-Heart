import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Copy, Gift, Link2, Loader2, Share2, Sparkles, UsersRound } from "lucide-react";
import { FaCrown, FaMedal, FaAward, FaTrophy } from "react-icons/fa";
import Header from "@/components/Header";
import MenuPopup from "@/components/MenuPopup";
import RewardsInfoPopup from "@/components/RewardsInfoPopup";
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
  const [rewardsOpen, setRewardsOpen] = useState(false);
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
  const friendsInvited = stats?.friendsInvited ?? user?.friendsInvited ?? 0;
  const commissionEarned = Math.floor(stats?.commissionEarned ?? 0);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: TEXT, display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      <Header onMenuOpen={() => setMenuOpen(true)} />
      <main style={{ flex: 1, overflowY: "auto", padding: "calc(var(--header-height, 62px) + 12px) clamp(12px, 4vw, 20px) 96px" }}>
        <section style={{
          position: "relative", overflow: "hidden", marginBottom: 12, padding: "18px 17px 15px",
          borderRadius: 18, background: "linear-gradient(135deg, #101a32 0%, #111827 52%, #101010 100%)",
          border: "1px solid rgba(96,165,250,0.18)", boxShadow: "0 12px 32px rgba(0,0,0,0.2)",
        }}>
          <div style={{ position: "absolute", width: 170, height: 170, borderRadius: "50%", right: -60, top: -72, background: "rgba(37,99,235,0.28)", filter: "blur(2px)" }} />
          <div style={{ position: "absolute", width: 100, height: 100, borderRadius: "50%", right: 54, bottom: -74, background: "rgba(59,130,246,0.12)" }} />
          <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#93c5fd", fontSize: 9, fontWeight: 900, letterSpacing: "0.12em" }}>
                <Sparkles size={12} />
                REWARDS HUB
              </div>
              <div style={{ marginTop: 8, fontSize: 22, lineHeight: 1.08, fontWeight: 900, letterSpacing: "-0.6px" }}>
                Invite friends.<br /><span style={{ color: "#60a5fa" }}>Grow your stack.</span>
              </div>
              <div style={{ maxWidth: 230, color: "rgba(219,234,254,0.62)", fontSize: 11, lineHeight: 1.45, marginTop: 8 }}>
                Automatic rewards when your network reaches milestones.
              </div>
            </div>
            <div style={{
              width: 52, height: 52, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 16, background: "linear-gradient(145deg, #2563eb, #3b82f6)",
              boxShadow: "0 8px 24px rgba(37,99,235,0.35)", transform: "rotate(4deg)",
            }}>
              <UsersRound size={26} color="#fff" strokeWidth={1.8} />
            </div>
          </div>
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: 17, borderTop: "1px solid rgba(147,197,253,0.14)", paddingTop: 13 }}>
            <div style={{ borderRight: "1px solid rgba(147,197,253,0.14)" }}>
              <div style={{ color: "#fff", fontSize: 20, lineHeight: 1, fontWeight: 900 }}>{friendsInvited.toLocaleString()}</div>
              <div style={{ color: "rgba(219,234,254,0.5)", fontSize: 9, marginTop: 5 }}>FRIENDS INVITED</div>
            </div>
            <div style={{ paddingLeft: 16 }}>
              <div style={{ color: "#4ade80", fontSize: 20, lineHeight: 1, fontWeight: 900 }}>{commissionEarned.toLocaleString()}</div>
              <div style={{ color: "rgba(219,234,254,0.5)", fontSize: 9, marginTop: 5 }}>CIPHER EARNED</div>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 12, padding: "12px 12px 11px", borderRadius: 15, background: CARD, border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Link2 size={14} color="#60a5fa" />
              <span style={{ color: "#fff", fontSize: 11, fontWeight: 800 }}>Your invite link</span>
            </div>
            {user?.referralCode && <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9, fontFamily: "monospace" }}>{user.referralCode}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0, padding: "10px 11px", borderRadius: 10, background: "rgba(0,0,0,0.24)", color: "rgba(255,255,255,0.55)", fontSize: 10, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {referralLink || "Preparing your invite link..."}
            </div>
            <button onClick={copyLink} disabled={!referralLink} aria-label="Copy invite link" style={{ width: 36, height: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: 10, background: "rgba(59,130,246,0.16)", color: "#93c5fd", cursor: referralLink ? "pointer" : "not-allowed", opacity: referralLink ? 1 : 0.5 }}>
              <Copy size={15} />
            </button>
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "1.35fr 0.65fr", gap: 8, marginBottom: 12 }}>
          <button onClick={shareLink} disabled={!referralLink || isSharing} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none", borderRadius: 12, padding: "12px 10px", color: "#fff", background: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`, fontSize: 12, fontWeight: 900, cursor: referralLink ? "pointer" : "not-allowed", boxShadow: "0 5px 18px rgba(37,99,235,0.28)", opacity: referralLink ? 1 : 0.5 }}>
            <Share2 size={15} />
            {isSharing ? "Opening..." : "Share invite"}
          </button>
          <button onClick={() => setRewardsOpen(true)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 8px", color: "#dbeafe", background: "rgba(255,255,255,0.05)", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
            <Gift size={14} color="#60a5fa" />
            Details
            <ArrowUpRight size={13} color="rgba(255,255,255,0.4)" />
          </button>
        </div>

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
            <div style={{ display: "grid", gap: 6 }}>
              {entries.map((entry) => (
                <div key={`${entry.rank}-${entry.username || entry.firstName}`} style={{ display: "grid", gridTemplateColumns: "38px 1fr auto", gap: 10, alignItems: "center", padding: "12px 14px", borderRadius: 13, background: CARD }}>
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
      {rewardsOpen && <RewardsInfoPopup onClose={() => setRewardsOpen(false)} />}
    </div>
  );
}