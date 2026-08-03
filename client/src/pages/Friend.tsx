import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { FaTrophy, FaCrown } from "react-icons/fa";
import { FaMedal, FaAward } from "react-icons/fa6";
import { showNotification } from "@/components/AppNotification";
import Header from "@/components/Header";
import MenuPopup from "@/components/MenuPopup";

const CARD = 'rgba(255,255,255,0.07)';
const TEXT = '#fff';
const TEXT_DIM = 'rgba(255,255,255,0.38)';
const BLUE = '#3b82f6';
const BLUE_D = '#2563eb';

const MEDAL: Record<number, { icon: React.ReactNode; color: string; glow: string }> = {
  1: { icon: <FaCrown size={18} color="#FFD700" />, color: '#FFD700', glow: 'rgba(255,215,0,0.10)' },
  2: { icon: <FaMedal size={18} color="#C0C0C0" />, color: '#C0C0C0', glow: 'rgba(192,192,192,0.07)' },
  3: { icon: <FaAward size={18} color="#CD7F32" />, color: '#CD7F32', glow: 'rgba(205,127,50,0.07)' },
};

type LbTab = 'cipher' | 'axn';

interface InviterEntry {
  rank: number;
  username: string | null;
  firstName: string;
  referrals: number;
  axnEarned: number;
}

interface AmountEntry {
  rank: number;
  username: string | null;
  firstName: string;
  amount: number;
}

interface WellData {
  wellBalance: number; totalEarned: number;
  totalFriends: number; totalWithdrawalCommission: number;
  activeFriends?: number;
}

function LbRow({ rank, username, firstName, value, unit, isMe }: {
  rank: number; username: string | null; firstName: string;
  value: number; unit: string; isMe: boolean;
}) {
  const medal = MEDAL[rank];
  const isTop3 = rank <= 3;

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '36px 1fr auto',
      alignItems: 'center', padding: '12px 16px', gap: 12,
      background: isMe ? 'rgba(59,130,246,0.08)' : isTop3 ? medal.glow : 'transparent',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      outline: isMe ? '1px solid rgba(59,130,246,0.2)' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isTop3 ? (
          <span style={{ display: 'flex', alignItems: 'center' }}>{medal.icon}</span>
        ) : (
          <span style={{ color: isMe ? '#60a5fa' : TEXT_DIM, fontSize: 12, fontWeight: 800, fontFamily: 'monospace' }}>
            {rank}
          </span>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            color: isTop3 ? medal.color : TEXT,
            fontSize: 13, fontWeight: isTop3 ? 800 : 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {username ? `@${username}` : firstName}
          </span>
          {isMe && (
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
              color: '#60a5fa', background: 'rgba(59,130,246,0.15)',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: 4, padding: '1px 5px', flexShrink: 0,
            }}>YOU</span>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <span style={{
          color: isTop3 ? medal.color : '#4ade80',
          fontSize: 13, fontWeight: 800,
        }}>
          {value.toLocaleString()}
        </span>
        {unit && <span style={{ color: TEXT_DIM, fontSize: 10, marginLeft: 3 }}>{unit}</span>}
      </div>
    </div>
  );
}

function LeaderboardTable<T extends { rank: number; username: string | null; firstName: string }>({
  entries, myRank, getValue, unit, myValue, isLoading, emptyText,
}: {
  entries: T[];
  myRank: T | null;
  getValue: (e: T) => number;
  unit: string;
  myValue: (e: T) => number;
  isLoading: boolean;
  emptyText: string;
}) {
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
        <Loader2 size={22} color="#60a5fa" className="animate-spin" />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div style={{ background: CARD, borderRadius: 14, padding: '36px 24px', textAlign: 'center' }}>
        <FaTrophy size={36} color="rgba(255,215,0,0.4)" style={{ marginBottom: 12 }} />
        <p style={{ color: TEXT, fontSize: 14, fontWeight: 800, margin: '0 0 4px' }}>No entries yet</p>
        <p style={{ color: TEXT_DIM, fontSize: 12, margin: 0 }}>{emptyText}</p>
      </div>
    );
  }

  const myRankInTop = myRank ? entries.some(e => e.rank === myRank.rank) : false;

  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '36px 1fr auto',
        padding: '9px 16px', gap: 12,
        background: 'rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ color: TEXT_DIM, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>#</span>
        <span style={{ color: TEXT_DIM, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>USERNAME</span>
        <span style={{ color: TEXT_DIM, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textAlign: 'right' }}>{unit || 'AMOUNT'}</span>
      </div>

      {entries.map((entry, i) => (
        <LbRow
          key={i}
          rank={entry.rank}
          username={entry.username}
          firstName={entry.firstName}
          value={getValue(entry)}
          unit={unit}
          isMe={myRank?.rank === entry.rank}
        />
      ))}

      {myRank && !myRankInTop && myValue(myRank) > 0 && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '6px 16px', gap: 4,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            {[0,1,2].map(d => (
              <div key={d} style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />
            ))}
          </div>
          <LbRow
            rank={myRank.rank}
            username={myRank.username}
            firstName={myRank.firstName}
            value={myValue(myRank)}
            unit={unit}
            isMe={true}
          />
        </>
      )}
    </div>
  );
}

export default function Friend() {
  const [isSharing, setIsSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lbTab, setLbTab] = useState<LbTab>('cipher');

  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], staleTime: 60000 });
  const { data: wellData } = useQuery<WellData>({ queryKey: ['/api/referrals/well'], staleTime: 30000 });
  const { data: botInfo } = useQuery<{ username: string }>({ queryKey: ['/api/bot-info'], staleTime: 3600000 });

  const { data: inviterData, isLoading: inviterLoading } = useQuery<{ leaderboard: AmountEntry[]; myRank: AmountEntry | null }>({
    queryKey: ['/api/leaderboard/cipher-earners'],
    staleTime: 60000,
  });
  const { data: axnData, isLoading: axnLoading } = useQuery<{ leaderboard: AmountEntry[]; myRank: AmountEntry | null }>({
    queryKey: ['/api/leaderboard/axn-holders'],
    staleTime: 60000,
    enabled: lbTab === 'axn',
  });

  const botUsername = botInfo?.username || 'bot';
  const referralLink = user?.referralCode ? `https://t.me/${botUsername}?start=${user.referralCode}` : '';
  const totalFriends = wellData?.totalFriends ?? (user?.friendsInvited ?? 0);
  const activeFriends = wellData?.activeFriends ?? 0;
  const totalEarned = wellData?.totalEarned ?? 0;

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    showNotification('Link copied!', 'success');
  };

  const shareLink = async () => {
    if (!referralLink || isSharing) return;
    setIsSharing(true);
    try {
      const tg = (window as any).Telegram?.WebApp;
      const url = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join Axionet! Earn CIPHER by watching ads, completing tasks, and inviting friends!')}`;
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, '_blank');
    } catch {}
    setIsSharing(false);
  };

  const LB_TABS: { id: LbTab; label: string }[] = [
    { id: 'cipher', label: 'Top CIPHER' },
    { id: 'axn', label: 'Top AXN' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column', overflowX: 'hidden', width: '100%' }}>
      <Header onMenuOpen={() => setMenuOpen(true)} />

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 clamp(12px, 4vw, 20px)', paddingBottom: 'max(86px, calc(env(safe-area-inset-bottom, 0px) + 86px))', paddingTop: 'calc(var(--header-height, 62px) + 12px)', width: '100%' }}>

        {/* Page title */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>
            Invite &amp; <span style={{ color: BLUE }}>Earn</span>
          </div>
          <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 3 }}>
            Earn 10% of your friends' CIPHER earnings
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          <div style={{ background: CARD, borderRadius: 14, padding: '10px 8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, textAlign: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="0" xmlns="http://www.w3.org/2000/svg">
                <circle cx="9" cy="7" r="3.5" fill="rgba(255,255,255,0.55)"/>
                <path d="M2 20c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="rgba(255,255,255,0.55)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
                <circle cx="17" cy="8" r="2.5" fill="rgba(255,255,255,0.3)"/>
                <path d="M20 20c0-2.761-1.343-5-3-5.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
              </svg>
              <div style={{ color: TEXT, fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{totalFriends}</div>
              <div style={{ color: TEXT_DIM, fontSize: 10, lineHeight: 1.3 }}>Total Friends</div>
            </div>
          </div>

          <div style={{ background: CARD, borderRadius: 14, padding: '10px 8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, textAlign: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="9" cy="7" r="3.5" fill="rgba(255,255,255,0.55)"/>
                <path d="M2 20c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="rgba(255,255,255,0.55)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
                <circle cx="18.5" cy="16.5" r="4" fill="#16a34a"/>
                <polyline points="16 16.5 18 18.5 21 15" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
              <div style={{ color: TEXT, fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{activeFriends}</div>
              <div style={{ color: TEXT_DIM, fontSize: 10, lineHeight: 1.3 }}>Active Friends</div>
            </div>
          </div>

          <div style={{ background: CARD, borderRadius: 14, padding: '10px 8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, textAlign: 'center' }}>
              {/* Circular CIPHER icon */}
              <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                <img
                  src="/cipher-icon.jpg"
                  alt="CIPHER"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
              <div style={{ color: TEXT, fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{Math.floor(totalEarned).toLocaleString()}</div>
              <div style={{ color: TEXT_DIM, fontSize: 10, lineHeight: 1.3 }}>Total Earned</div>
            </div>
          </div>
        </div>

        {/* Active friend info */}
        <div style={{ background: 'rgba(37,99,235,0.06)', borderRadius: 12, padding: '10px 14px', marginBottom: 16 }}>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: 0, lineHeight: 1.5 }}>
            Active Friends have earned at least <span style={{ color: BLUE, fontWeight: 700 }}>500 CIPHER</span>. You earn <span style={{ color: BLUE, fontWeight: 700 }}>10% of their ad earnings</span>.
          </p>
        </div>

        {/* Invite buttons */}
        <p style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', margin: '0 0 8px' }}>Your Invite Link</p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          <button
            onClick={copyLink}
            disabled={!referralLink}
            className="active:scale-95 transition-transform"
            style={{
              flex: 1, background: 'rgba(255,255,255,0.07)', border: 'none',
              borderRadius: 14, color: referralLink ? '#fff' : TEXT_DIM,
              fontSize: 14, fontWeight: 800, padding: '14px 0',
              cursor: referralLink ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: !referralLink ? 0.5 : 1,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy
          </button>

          <button
            onClick={shareLink}
            disabled={!referralLink || isSharing}
            className="active:scale-95 transition-transform"
            style={{
              flex: 1, background: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`,
              border: 'none', borderRadius: 14, color: '#fff',
              fontSize: 14, fontWeight: 800, padding: '14px 0',
              cursor: referralLink ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 4px 20px rgba(37,99,235,0.35)',
              opacity: !referralLink ? 0.5 : 1,
            }}
          >
            {isSharing ? <Loader2 size={16} className="animate-spin" /> : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
              </svg>
            )}
            Share
          </button>
        </div>

        {/* Leaderboard header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <FaTrophy size={12} color="#FFD700" />
          <p style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', margin: 0 }}>
            Leaderboard
          </p>
        </div>

        {/* Leaderboard tabs */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 12,
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 50, padding: 4,
        }}>
          {LB_TABS.map(t => (
            <button key={t.id} onClick={() => setLbTab(t.id)} style={{
              flex: 1, padding: '8px 0', border: 'none',
              background: lbTab === t.id ? `linear-gradient(135deg, ${BLUE_D}, ${BLUE})` : 'transparent',
              fontSize: 11, fontWeight: lbTab === t.id ? 800 : 600,
              color: lbTab === t.id ? '#fff' : TEXT_DIM,
              cursor: 'pointer', borderRadius: 50,
              boxShadow: lbTab === t.id ? '0 2px 10px rgba(37,99,235,0.3)' : 'none',
              transition: 'all 0.2s', whiteSpace: 'nowrap',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Top CIPHER Holders */}
        {lbTab === 'cipher' && (
          <LeaderboardTable
            entries={inviterData?.leaderboard ?? []}
            myRank={inviterData?.myRank ?? null}
            getValue={(e) => (e as AmountEntry).amount}
            unit="CIPHER"
            myValue={(e) => (e as AmountEntry).amount}
            isLoading={inviterLoading}
            emptyText="Earn CIPHER by watching ads and completing tasks!"
          />
        )}

        {/* Top AXN Holders */}
        {lbTab === 'axn' && (
          <LeaderboardTable
            entries={axnData?.leaderboard ?? []}
            myRank={axnData?.myRank ?? null}
            getValue={(e) => e.amount}
            unit="AXN"
            myValue={(e) => e.amount}
            isLoading={axnLoading}
            emptyText="Farm AXN to appear on this leaderboard!"
          />
        )}

      </div>

      {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
