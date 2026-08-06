import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import MenuPopup from "@/components/MenuPopup";
import Header from "@/components/Header";
import { useLocation } from "wouter";
import WithdrawPopup from "@/components/WithdrawPopup";
import { useAdmin } from "@/hooks/useAdmin";
import { getGramPrice, axnToGram, gramToUsd, formatGram, formatUsd } from "@/lib/tonPriceService";
import { ArrowUpRight, History, Loader2, Receipt } from "lucide-react";
import { AXNIcon } from "@/components/AXNIcon";
const AXN_PER_GRAM = 100000;

export default function Games() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [gramPrice, setGramPrice] = useState<number>(3.5);
  const [showStakingPopup, setShowStakingPopup] = useState(false);
  const [showWithdrawPopup, setShowWithdrawPopup] = useState(false);
  const [showPromoPopup, setShowPromoPopup] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { isAdmin } = useAdmin();
  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], staleTime: 0 });
  const { data: botInfo } = useQuery<{ username: string }>({ queryKey: ['/api/bot-info'], staleTime: 3600000 });
  const { data: transactionData, isLoading: transactionsLoading } = useQuery<{
    transactions?: any[];
    withdrawals?: any[];
  }>({ queryKey: ['/api/transactions'], staleTime: 15000 });
  const axnRaw = parseFloat(user?.walletBalance || '0');
  const axnBalance = Math.floor(axnRaw);
  const gramValue = axnToGram(axnRaw);
  const usdValue = gramToUsd(gramValue, gramPrice);
  const gramDisplay = formatGram(gramValue);
  const usdDisplay = formatUsd(usdValue);
  const axnDisplay = axnRaw === 0 ? '0' : axnRaw % 1 === 0
    ? axnRaw.toLocaleString()
    : parseFloat(axnRaw.toFixed(6)).toLocaleString(undefined, { maximumFractionDigits: 6 });

  const firstName: string = user?.firstName || user?.username || "User";
  const profileImageUrl: string | null =
    user?.profileImageUrl ||
    (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url) ||
    null;
  const initials = firstName.slice(0, 2).toUpperCase();

  const botUsername = botInfo?.username || 'bot';
  const referralLink = user?.referralCode ? `https://t.me/${botUsername}?start=${user.referralCode}` : '';
  const transactionHistory = [
    ...(transactionData?.transactions || []).map((transaction: any) => ({
      id: `transaction-${transaction.id}`,
      amount: transaction.amount,
      label: transaction.description || transaction.source || transaction.type || 'Balance update',
      status: transaction.type || 'completed',
      createdAt: transaction.createdAt,
      kind: 'transaction' as const,
    })),
    ...(transactionData?.withdrawals || []).map((withdrawal: any) => ({
      id: `withdrawal-${withdrawal.id}`,
      amount: withdrawal.amount,
      label: 'Withdrawal',
      status: withdrawal.status || 'pending',
      createdAt: withdrawal.createdAt,
      kind: 'withdrawal' as const,
    })),
  ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
       const price = await getGramPrice();
       if (!cancelled) setGramPrice(price);
    };
    fetch();
    const interval = setInterval(fetch, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink)
      .then(() => showNotification('Invite link copied!', 'success'))
      .catch(() => showNotification('Invite link copied!', 'success'));
  };

  const shareLink = async () => {
    if (!referralLink || isSharing) return;
    setIsSharing(true);
    try {
      const tg = (window as any).Telegram?.WebApp;
      const url = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join Axionet and earn automatic referral rewards!')}`;
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, '_blank');
    } catch {}
    setIsSharing(false);
  };

  return (
    <div style={{ height: '100dvh', background: '#0a0a0a', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes axn-glow { 0%,100%{opacity:0.3} 50%{opacity:0.7} }
        @keyframes axn-pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
        @keyframes popup-glow { 0%,100%{opacity:0.5} 50%{opacity:1} }
      `}</style>

      <Header onMenuOpen={() => setMenuOpen(true)} />

      {/* Balance Section */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--header-height, 62px) + 14px)',
        paddingLeft: 'clamp(12px, 4vw, 24px)',
        paddingRight: 'clamp(12px, 4vw, 24px)',
        paddingBottom: 12,
        textAlign: 'center',
        overflow: 'hidden',
      }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
            Wallet Balance
          </div>

          {/* AXN main balance */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 1, maxWidth: '100%', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: axnDisplay.length > 16 ? 22 : axnDisplay.length > 14 ? 26 : axnDisplay.length > 10 ? 34 : 42,
              fontWeight: 700, color: '#fff',
              fontFamily: "'Oxanium', 'Space Grotesk', sans-serif",
              letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums', lineHeight: 1,
              wordBreak: 'break-all', overflowWrap: 'break-word', minWidth: 0,
              maxWidth: 'calc(100vw - 80px)',
            }}>
              {balanceHidden ? '••••' : axnDisplay}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.45)', alignSelf: 'flex-end', paddingBottom: 4 }}>AXN</span>
            <button onClick={() => setBalanceHidden(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, alignSelf: 'center', flexShrink: 0 }}>
              {balanceHidden ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>

          {/* GRAM and USD sub-values */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', fontWeight: 500 }}>
              {balanceHidden ? '≈ •••• GRAM' : `≈ ${gramDisplay} GRAM`}
            </span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', fontWeight: 500 }}>
              {balanceHidden ? '≈ $••••' : `≈ $${usdDisplay}`}
            </span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'clamp(10px, 4vw, 22px)', flexWrap: 'wrap', maxWidth: '100%' }}>

            {/* Withdraw */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <button
                onClick={() => setShowWithdrawPopup(true)}
                style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
                  border: 'none',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 16px rgba(37,99,235,0.4)',
                }}
                className="active:scale-90 transition-transform"
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v14M5 9l7 7 7-7"/><path d="M3 20h18"/>
                </svg>
              </button>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.48)' }}>Withdraw</span>
            </div>

            {/* Staking */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <button onClick={() => setShowStakingPopup(true)} style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
                border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(37,99,235,0.4)',
              }} className="active:scale-90 transition-transform">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </button>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.48)' }}>Staking</span>
            </div>

            {/* Promo */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <button onClick={() => setShowPromoPopup(true)} style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(37,99,235,0.4)',
              }} className="active:scale-90 transition-transform">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                </svg>
              </button>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.48)' }}>Promo</span>
            </div>

          </div>
      </div>

      {/* Scrollable Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '8px clamp(12px, 4vw, 20px)', paddingBottom: 'max(90px, calc(env(safe-area-inset-bottom, 0px) + 90px))', width: '100%' }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Receipt size={18} color="rgba(255,255,255,0.7)" strokeWidth={1.8} />
            <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px' }}>
              <span style={{ color: 'rgba(255,255,255,0.28)' }}>Transaction </span>
              <span style={{ color: '#3b82f6' }}>History</span>
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 3 }}>Your balance activity and withdrawals.</div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
          {transactionsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 28 }}>
              <Loader2 size={22} color="rgba(255,255,255,0.45)" className="animate-spin" />
            </div>
          ) : transactionHistory.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '30px 18px', color: 'rgba(255,255,255,0.25)' }}>
              <History size={26} strokeWidth={1.7} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>No transactions yet</span>
            </div>
          ) : (
            transactionHistory.map((entry, index) => {
              const isWithdrawal = entry.kind === 'withdrawal';
              const status = String(entry.status || '').replace(/_/g, ' ');
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>
                  {isWithdrawal
                    ? <ArrowUpRight size={24} color="rgba(255,255,255,0.7)" strokeWidth={1.8} style={{ flexShrink: 0 }} />
                    : <AXNIcon size={24} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.label}</div>
                    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 3 }}>
                      {entry.createdAt ? new Date(entry.createdAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ color: isWithdrawal ? '#fff' : '#3b82f6', fontSize: 13, fontWeight: 900 }}>{isWithdrawal ? '-' : '+'}{Number(entry.amount || 0).toLocaleString()} AXN</div>
                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 3, textTransform: 'capitalize' }}>{status}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Promo Popup */}
      {showPromoPopup && (
        <PromoPopup
          onClose={() => setShowPromoPopup(false)}
          onSuccess={() => { queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] }); setShowPromoPopup(false); }}
        />
      )}

      {/* Withdraw Popup */}
      {showWithdrawPopup && (
        <WithdrawPopup
          onClose={() => setShowWithdrawPopup(false)}
          userBalance={axnBalance}
          isAdmin={isAdmin}
        />
      )}

      {/* Staking Popup */}
      {showStakingPopup && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={() => setShowStakingPopup(false)} />
          <div style={{
            position: 'relative', width: '100%',
            background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
            border: '1px solid rgba(37,99,235,0.25)',
            borderRadius: '28px 28px 0 0', padding: '28px 20px', paddingBottom: 'max(52px, calc(env(safe-area-inset-bottom, 0px) + 28px))', zIndex: 901, textAlign: 'center',
            boxShadow: '0 -8px 60px rgba(37,99,235,0.2), 0 0 0 1px rgba(255,255,255,0.03)',
            overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)', animation: 'popup-glow 2s ease-in-out infinite' }} />
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 24px' }} />
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 18px',
              background: 'linear-gradient(135deg, rgba(37,99,235,0.2), rgba(59,130,246,0.1))',
              border: '1px solid rgba(37,99,235,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 28px rgba(37,99,235,0.25)',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', marginBottom: 8 }}>AXN Staking</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.38)', marginBottom: 10, lineHeight: 1.55 }}>
              Stake your AXN to earn passive rewards.
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 50, padding: '5px 14px', marginBottom: 28,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'axn-pulse 1.5s ease-in-out infinite' }} />
              <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700 }}>Launching Soon</span>
            </div>
            <button onClick={() => setShowStakingPopup(false)} style={{
              width: '100%', padding: '14px',
              background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
              border: 'none', borderRadius: 50, color: '#fff',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(37,99,235,0.4)',
            }} className="active:scale-95 transition-transform">Got it</button>
          </div>
        </div>
      )}

      {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _SendChoicePopupRemoved({ user, onClose, onWithdraw, onSuccess }: {
  user: any;
  onClose: () => void;
  onWithdraw: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<null | 'user'>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const usdPreview = '';

  const handleSend = async () => {
    if (!recipient || !amount) { showNotification('Fill in recipient and amount', 'error'); return; }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) { showNotification('Enter a valid amount', 'error'); return; }
    setLoading(true);
    try {
      const res = await apiRequest('POST', '/api/transfers/send', { recipient, amount: num, note });
      const data = await res.json();
      if (data.success) {
        showNotification(`Sent ${num} AXN successfully!`, 'success');
        onSuccess();
      } else {
        showNotification(data.message || 'Transfer failed', 'error');
      }
    } catch {
      showNotification('Transfer failed. Try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '13px 14px', borderRadius: 14,
    border: '1.5px solid rgba(37,99,235,0.2)',
    fontSize: 15, color: '#fff',
    background: 'rgba(255,255,255,0.04)', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
        border: '1px solid rgba(37,99,235,0.25)',
        borderRadius: '28px 28px 0 0', padding: '24px 20px 52px', zIndex: 901,
        boxShadow: '0 -8px 60px rgba(37,99,235,0.2), 0 0 0 1px rgba(255,255,255,0.03)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 22px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: mode ? 22 : 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode && (
              <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginLeft: -4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              </button>
            )}
            <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>
              {mode === 'user' ? 'Send to User' : 'Send AXN'}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {!mode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => setMode('user')} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.18)',
              borderRadius: 18, padding: '18px 20px', cursor: 'pointer', textAlign: 'left',
            }} className="active:scale-[0.98] transition-transform">
              <div style={{
                width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(37,99,235,0.4)',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2" fill="white" stroke="none" opacity="0.9"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, marginBottom: 3 }}>Send to User</div>
                <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>Internal transfer using User ID</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>

            <button onClick={onWithdraw} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.18)',
              borderRadius: 18, padding: '18px 20px', cursor: 'pointer', textAlign: 'left',
            }} className="active:scale-[0.98] transition-transform">
              <div style={{
                width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #5b21b6, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(124,58,237,0.4)',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, marginBottom: 3 }}>Withdraw</div>
                <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>Send to external GRAM wallet</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        )}

        {mode === 'user' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.32)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recipient User ID</div>
              <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Enter User ID..." style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.32)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Amount (AXN)</div>
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="0" style={inputStyle} />
              {usdPreview && <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 5 }}>{usdPreview}</div>}
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.32)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Note (optional)</div>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note..." style={inputStyle} />
            </div>
            <button
              onClick={handleSend}
              disabled={loading}
              style={{
                width: '100%', padding: '14px',
                background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                border: 'none', borderRadius: 14, color: loading ? 'rgba(255,255,255,0.3)' : '#fff',
                fontSize: 15, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(37,99,235,0.4)',
              }}
              className="active:scale-95 transition-transform"
            >
              {loading ? 'Sending...' : 'Send AXN'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _ReceivePopupRemoved({ user, onClose }: { user: any; onClose: () => void }) {
  const copyId = () => {
    const id = user?.id?.toString() || '';
    navigator.clipboard.writeText(id).then(() => showNotification('User ID copied!', 'success')).catch(() => {});
  };
  const copyUsername = () => {
    const un = user?.username || '';
    navigator.clipboard.writeText(un).then(() => showNotification('Username copied!', 'success')).catch(() => {});
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
        border: '1px solid rgba(37,99,235,0.25)',
        borderRadius: '28px 28px 0 0', padding: '24px 20px 52px', zIndex: 901,
        boxShadow: '0 -8px 60px rgba(37,99,235,0.2)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 22px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>Receive AXN</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 20 }}>
          Share your User ID or username so others can send you AXN directly.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>User ID</div>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, fontFamily: 'monospace' }}>{user?.id ?? '—'}</div>
            </div>
            <button onClick={copyId} style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', border: 'none', borderRadius: 9, padding: '7px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Copy</button>
          </div>
          {user?.username && (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Username</div>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, fontFamily: 'monospace' }}>@{user.username}</div>
              </div>
              <button onClick={copyUsername} style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', border: 'none', borderRadius: 9, padding: '7px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Copy</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PromoPopup({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [adStep, setAdStep] = useState<'idle' | 'watching-ad' | 'redeeming'>('idle');

  const handleRedeem = async () => {
    if (!code.trim()) { showNotification('Enter a promo code', 'error'); return; }
    if (loading) return;
    setLoading(true);

    try {
      setAdStep('redeeming');
      const res = await apiRequest('POST', '/api/promo-codes/redeem', { code: code.trim() });
      const data = await res.json();
      if (data.success) {
        showNotification(data.message || 'Promo code redeemed!', 'success');
        onSuccess();
      } else {
        showNotification(data.message || 'Invalid promo code', 'error');
      }
    } catch {
      showNotification('Failed to redeem. Try again.', 'error');
    } finally {
      setLoading(false);
      setAdStep('idle');
    }
  };

  const buttonLabel = adStep === 'redeeming' ? 'Redeeming...' : 'Redeem';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={!loading ? onClose : undefined} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f 0%, #111118 100%)',
        border: '1px solid rgba(37,99,235,0.25)',
        borderRadius: '28px 28px 0 0', padding: '24px 20px 52px', zIndex: 901,
        boxShadow: '0 -8px 60px rgba(37,99,235,0.2)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)' }} />
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 22px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>Promo Code</span>
        </div>

        <div style={{ marginBottom: 8 }}>
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="Enter promo code..."
            disabled={loading}
            style={{
              width: '100%', padding: '14px', borderRadius: 14,
              border: '1.5px solid rgba(37,99,235,0.2)',
              fontSize: 15, color: '#fff', letterSpacing: '0.08em', fontWeight: 700,
              background: 'rgba(255,255,255,0.04)', outline: 'none',
              boxSizing: 'border-box', textAlign: 'center',
              opacity: loading ? 0.5 : 1,
            }}
          />
        </div>
        <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>A short ad plays before your reward is unlocked</p>
        <button
          onClick={handleRedeem}
          disabled={loading}
          style={{
            width: '100%', padding: '14px',
            background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
            border: 'none', borderRadius: 14, color: loading ? 'rgba(255,255,255,0.3)' : '#fff',
            fontSize: 15, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
            boxShadow: loading ? 'none' : '0 4px 20px rgba(37,99,235,0.4)',
          }}
          className="active:scale-95 transition-transform"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
