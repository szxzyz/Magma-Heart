import { useState, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useTonConnectUI, useTonAddress, TonConnectButton } from "@tonconnect/ui-react";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { CUT_LG, CORNER_ACCENTS_LG, cornerAccentStyle, outerBorderStyle, centeredOverlayStyle, backdropStyle } from "@/lib/cutCorner";

const TREASURY = 'UQDeroBz4zvOntJ4xuMdiwFtNddMhJ4cGxghF9B7fYz50q8b';
const MIN_AXN = 1000;
const FEE_NANO = '30000000';

const STATUS_LABELS: Record<string, { label: string; color: string; icon: 'spin' | 'check' | 'fail' | 'clock' }> = {
  pending_payment:   { label: 'Waiting for TON payment',        color: '#f59e0b', icon: 'clock' },
  payment_confirmed: { label: 'Payment confirmed, sending AXN', color: '#3b82f6', icon: 'spin'  },
  axn_sent:          { label: 'AXN dispatched',                 color: '#3b82f6', icon: 'spin'  },
  completed:         { label: 'Withdrawal complete',            color: '#4ade80', icon: 'check' },
  failed:            { label: 'Failed — contact support',       color: '#f87171', icon: 'fail'  },
  expired:           { label: 'Expired — balance refunded',     color: '#f87171', icon: 'fail'  },
};

interface Props { onClose: () => void; userBalance: number; isAdmin?: boolean; }

export default function WithdrawPopup({ onClose, userBalance }: Props) {
  const [tonConnectUI] = useTonConnectUI();
  const connectedAddress = useTonAddress();

  const [amount, setAmount]           = useState('');
  const [claimId, setClaimId]         = useState<string | null>(null);
  const [claimStatus, setClaimStatus] = useState('pending_payment');
  const [expiresAt, setExpiresAt]     = useState<Date | null>(null);
  const [step, setStep]               = useState<'input' | 'paying' | 'tracking'>('input');
  const [countdown, setCountdown]     = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!expiresAt || step !== 'tracking') return;
    const iv = setInterval(() => {
      const diff = Math.max(0, expiresAt.getTime() - Date.now());
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${m}:${s.toString().padStart(2, '0')}`);
      if (diff === 0) clearInterval(iv);
    }, 1000);
    return () => clearInterval(iv);
  }, [expiresAt, step]);

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res  = await apiRequest('GET', `/api/ton-withdraw/status/${id}`);
      const data = await res.json();
      const status = data.claim?.status;
      if (status) {
        setClaimStatus(status);
        if (status === 'completed') {
          queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
          queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
        }
      }
    } catch {}
  }, [queryClient]);

  useEffect(() => {
    if (step !== 'tracking' || !claimId) return;
    if (['completed', 'failed', 'expired'].includes(claimStatus)) return;
    const iv = setInterval(() => pollStatus(claimId), 5000);
    return () => clearInterval(iv);
  }, [step, claimId, claimStatus, pollStatus]);

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(amount);
      if (!connectedAddress) throw new Error('Connect your TON wallet first');
      if (!amt || amt < MIN_AXN) throw new Error(`Minimum ${MIN_AXN.toLocaleString()} AXN`);
      if (amt > userBalance) throw new Error('Insufficient balance');
      const res  = await apiRequest('POST', '/api/ton-withdraw/initiate', { walletAddress: connectedAddress, axnAmount: amt });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed');
      return data;
    },
    onSuccess: async (data) => {
      setClaimId(data.claimId);
      setExpiresAt(new Date(data.expiresAt));
      setStep('paying');
      try {
        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 1800,
          messages: [{ address: TREASURY, amount: data.feeNano || FEE_NANO }],
        });
        setStep('tracking');
        setClaimStatus('pending_payment');
      } catch {
        try { await apiRequest('POST', `/api/ton-withdraw/cancel/${data.claimId}`, {}); } catch {}
        showNotification('Payment cancelled — your balance has been refunded', 'info');
        setStep('input');
        setClaimId(null);
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      }
    },
    onError: (e: any) => {
      let msg = 'Withdrawal failed';
      try { const p = JSON.parse(e.message); if (p.message) msg = p.message; } catch { msg = e.message || msg; }
      showNotification(msg, 'error');
    },
  });

  const amtNum       = parseFloat(amount) || 0;
  const isProcessing = initiateMutation.isPending || step === 'paying';
  const isDone       = ['completed', 'failed', 'expired'].includes(claimStatus);
  const canSubmit    = !!connectedAddress && amtNum >= MIN_AXN && amtNum <= userBalance && !isProcessing;

  return (
    <div style={centeredOverlayStyle()} onClick={onClose}>
      <style>{`
        @keyframes wd-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={backdropStyle()} />

      <div style={outerBorderStyle(420)}>
      <div
        style={{
          position: 'relative', width: '100%',
          background: '#0a0a0a', clipPath: CUT_LG,
          padding: '20px 16px max(20px, calc(env(safe-area-inset-bottom,0px) + 12px))',
          maxHeight: '86vh', overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {CORNER_ACCENTS_LG.map((s, i) => (<div key={i} style={{ ...cornerAccentStyle, ...s }} />))}

        {/* Title */}
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 20 }}>Withdraw AXN</div>

        {/* ── TRACKING VIEW ── */}
        {step === 'tracking' && claimId && (
          <TrackingView
            claimStatus={claimStatus}
            claimId={claimId}
            axnAmount={amtNum}
            countdown={countdown}
            isDone={isDone}
            onClose={onClose}
          />
        )}

        {/* ── INPUT VIEW ── */}
        {step !== 'tracking' && (
          <>
            {/* Info rows */}
            <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, marginBottom: 14, overflow: 'hidden' }}>
              <Row label="Your balance" value={`${Math.floor(userBalance).toLocaleString()} AXN`} />
              <Divider />
              <Row label="Minimum"      value={`${MIN_AXN.toLocaleString()} AXN`} />
              <Divider />
              <Row label="Network fee"  value="0.03 TON" sub="Gas fee for on-chain token transfer" />
            </div>

            {/* TON Wallet */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                TON Wallet
              </div>
              {connectedAddress ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <svg width="18" height="18" viewBox="0 0 56 56" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M28 0C12.536 0 0 12.536 0 28s12.536 28 28 28 28-12.536 28-28S43.464 0 28 0z" fill="#0098EA"/>
                    <path d="M37.115 15.5H18.885c-3.4 0-5.5 3.7-3.7 6.6l10.3 17.8c.8 1.4 2.8 1.4 3.6 0l10.3-17.8c1.7-2.9-.3-6.6-3.7-6.6zm-10.5 16.5l-6.4-11.1h6.4v11.1zm2.8 0V20.9h6.4l-6.4 11.1z" fill="white"/>
                  </svg>
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
                    {connectedAddress.slice(0, 8)}…{connectedAddress.slice(-6)}
                  </span>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 700, padding: 0 }}
                    onClick={() => tonConnectUI.disconnect()}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ position: 'relative', display: 'inline-flex' }}>
                    <TonConnectButton />
                    <div
                      style={{ position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 10 }}
                      onClick={() => tonConnectUI.openModal()}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Amount */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Amount
                </div>
                <button
                  onClick={() => setAmount(Math.floor(userBalance).toString())}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', fontSize: 11, fontWeight: 700, padding: 0 }}
                >
                  MAX
                </button>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 16px' }}>
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder={`Min ${MIN_AXN.toLocaleString()}`}
                  disabled={isProcessing}
                  style={{
                    flex: 1, padding: '14px 0', background: 'none', border: 'none', outline: 'none',
                    color: '#fff', fontSize: 16, fontWeight: 700,
                  }}
                />
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: 700 }}>AXN</span>
              </div>
              {amtNum > 0 && amtNum < MIN_AXN && (
                <div style={{ color: '#f87171', fontSize: 11, marginTop: 5 }}>Minimum {MIN_AXN.toLocaleString()} AXN required</div>
              )}
              {amtNum > userBalance && amtNum > 0 && (
                <div style={{ color: '#f87171', fontSize: 11, marginTop: 5 }}>Insufficient balance</div>
              )}
            </div>

            {/* Submit */}
            <button
              onClick={() => initiateMutation.mutate()}
              disabled={!canSubmit}
              className="active:scale-95 transition-transform"
              style={{
                width: '100%', padding: '14px 0', border: 'none', borderRadius: 14,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                background: canSubmit ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'rgba(255,255,255,0.06)',
                color: canSubmit ? '#fff' : 'rgba(255,255,255,0.2)',
                fontSize: 14, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: canSubmit ? '0 2px 16px rgba(37,99,235,0.35)' : 'none',
              } as React.CSSProperties}
            >
              {isProcessing && <Loader2 size={15} style={{ animation: 'wd-spin 1s linear infinite' }} />}
              {step === 'paying' ? 'Opening wallet…' : isProcessing ? 'Processing…' : 'Confirm Withdrawal'}
            </button>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function Row({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', gap: 12 }}>
      <div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{label}</div>
        {sub && <div style={{ color: 'rgba(255,255,255,0.22)', fontSize: 11, marginTop: 2 }}>{sub}</div>}
      </div>
      <span style={{ color: valueColor || '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />;
}

function TrackingView({ claimStatus, claimId, axnAmount, countdown, isDone, onClose }: {
  claimStatus: string; claimId: string; axnAmount: number;
  countdown: string; isDone: boolean; onClose: () => void;
}) {
  const info    = STATUS_LABELS[claimStatus] || STATUS_LABELS.pending_payment;
  const steps   = [
    { key: 'pending_payment',   label: 'TON gas fee received'     },
    { key: 'payment_confirmed', label: 'Payment verified on-chain' },
    { key: 'axn_sent',          label: 'AXN dispatched to wallet'  },
    { key: 'completed',         label: 'Delivered successfully'    },
  ];
  const order      = ['pending_payment', 'payment_confirmed', 'axn_sent', 'completed'];
  const currentIdx = order.indexOf(claimStatus);

  return (
    <>
      {/* Status */}
      <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        {info.icon === 'spin'  && <Loader2      size={20} style={{ color: info.color, animation: 'wd-spin 1s linear infinite', flexShrink: 0 }} />}
        {info.icon === 'check' && <CheckCircle2 size={20} style={{ color: info.color, flexShrink: 0 }} />}
        {info.icon === 'fail'  && <XCircle      size={20} style={{ color: info.color, flexShrink: 0 }} />}
        {info.icon === 'clock' && <Clock        size={20} style={{ color: info.color, flexShrink: 0 }} />}
        <div>
          <div style={{ color: info.color, fontSize: 14, fontWeight: 700 }}>{info.label}</div>
          {claimStatus === 'pending_payment' && countdown && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 2 }}>Expires in {countdown}</div>
          )}
          {claimStatus === 'completed' && (
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>{Math.floor(axnAmount).toLocaleString()} AXN sent</div>
          )}
        </div>
      </div>

      {/* Steps */}
      <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, marginBottom: 14, overflow: 'hidden' }}>
        {steps.map((s, idx) => {
          const done   = currentIdx > idx || claimStatus === 'completed';
          const active = currentIdx === idx && !isDone;
          const failed = (claimStatus === 'failed' || claimStatus === 'expired') && idx === Math.max(0, currentIdx);
          return (
            <div key={s.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  border: `1.5px solid ${failed ? '#f87171' : done ? '#4ade80' : active ? '#3b82f6' : 'rgba(255,255,255,0.12)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800,
                  color: failed ? '#f87171' : done ? '#4ade80' : active ? '#3b82f6' : 'rgba(255,255,255,0.2)',
                }}>
                  {done ? '✓' : failed ? '✕' : idx + 1}
                </div>
                <span style={{ flex: 1, color: done ? '#d1fae5' : active ? '#93c5fd' : 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: done || active ? 700 : 400 }}>
                  {s.label}
                </span>
                {active && !failed && <Loader2 size={12} style={{ color: '#3b82f6', animation: 'wd-spin 1s linear infinite' }} />}
              </div>
              {idx < steps.length - 1 && <Divider />}
            </div>
          );
        })}
      </div>

      <div style={{ color: 'rgba(255,255,255,0.14)', fontSize: 10, fontFamily: 'monospace', marginBottom: 14, wordBreak: 'break-all' }}>
        ID: {claimId}
      </div>

      {isDone && (
        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '14px 0', border: 'none', borderRadius: 14, cursor: 'pointer',
            background: claimStatus === 'completed' ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'rgba(255,255,255,0.07)',
            color: '#fff', fontSize: 14, fontWeight: 800,
            boxShadow: claimStatus === 'completed' ? '0 2px 16px rgba(37,99,235,0.35)' : 'none',
          }}
        >
          {claimStatus === 'completed' ? 'Done' : 'Close'}
        </button>
      )}
    </>
  );
}
