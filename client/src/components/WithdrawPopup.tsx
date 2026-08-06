import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { useTonConnectUI, useTonAddress, TonConnectButton } from "@tonconnect/ui-react";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import PopupShell from "@/components/PopupShell";

const FEE_RATE = 0.10;
const DEFAULT_MIN = 10000;

type Eligibility = {
  adsCompletedToday: number;
  adsRequiredToday: number;
  adsRemaining: number;
  hasCompletedAdsToday: boolean;
  hasWithdrawnToday: boolean;
  hasDeposited: boolean;
  minWithdrawal: number;
  maxDailyWithdrawal: number | null;
  balance: number;
};

interface Props { onClose: () => void; userBalance: number; isAdmin?: boolean; }

export default function WithdrawPopup({ onClose, userBalance }: Props) {
  const [tonConnectUI] = useTonConnectUI();
  const connectedAddress = useTonAddress();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'input' | 'success'>('input');
  const [resultInfo, setResultInfo] = useState<{ net: number; fee: number } | null>(null);

  const { data: eligibility, isLoading: eligibilityLoading } = useQuery<Eligibility>({
    queryKey: ['/api/withdraw/eligibility'],
    staleTime: 0,
  });

  const minWithdrawal = eligibility?.minWithdrawal ?? DEFAULT_MIN;
  const maxWithdrawal = eligibility?.maxDailyWithdrawal ?? null;
  const adsOk = eligibility ? eligibility.hasCompletedAdsToday : false;
  const alreadyWithdrawnToday = eligibility?.hasWithdrawnToday ?? false;

  const amtNum = parseFloat(amount) || 0;
  const fee = amtNum * FEE_RATE;
  const netAmount = amtNum - fee;

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!connectedAddress) throw new Error('Connect your TON wallet first');
      if (!amtNum || amtNum < minWithdrawal) throw new Error(`Minimum ${minWithdrawal.toLocaleString()} AXN`);
      if (maxWithdrawal !== null && amtNum > maxWithdrawal) throw new Error(`Maximum ${maxWithdrawal.toLocaleString()} AXN per day`);
      if (amtNum > userBalance) throw new Error('Insufficient balance');
      const res = await apiRequest('POST', '/api/withdrawals', { amount: amtNum, address: connectedAddress });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed');
      return data;
    },
    onSuccess: (data) => {
      setResultInfo({ net: data.netAmount ?? netAmount, fee: data.fee ?? fee });
      setStep('success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/withdraw/eligibility'] });
    },
    onError: (e: any) => {
      let msg = 'Withdrawal request failed';
      try { const p = JSON.parse(e.message); if (p.message) msg = p.message; } catch { msg = e.message || msg; }
      showNotification(msg, 'error');
    },
  });

  const isProcessing = submitMutation.isPending;
  const canSubmit =
    !!connectedAddress &&
    amtNum >= minWithdrawal &&
    (maxWithdrawal === null || amtNum <= maxWithdrawal) &&
    amtNum <= userBalance &&
    adsOk &&
    !alreadyWithdrawnToday &&
    !isProcessing &&
    !eligibilityLoading;

  return (
    <PopupShell onClose={onClose} closeOnBackdrop={!isProcessing}>
      <style>{`@keyframes wd-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Title */}
      <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, textAlign: 'center', marginBottom: 20 }}>
        Withdraw AXN
      </div>

      {step === 'success' && resultInfo ? (
        <SuccessView net={resultInfo.net} fee={resultInfo.fee} onClose={onClose} />
      ) : (
        <>
          {/* Balance Info */}
          <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, marginBottom: 14, overflow: 'hidden' }}>
            <Row label="Your balance" value={`${Math.floor(userBalance).toLocaleString()} AXN`} />
            <Divider />
            <Row label="Minimum withdrawal" value={`${minWithdrawal.toLocaleString()} AXN`} />
            <Divider />
            <Row
              label="Maximum daily"
              value={maxWithdrawal !== null ? `${maxWithdrawal.toLocaleString()} AXN` : 'No limit'}
            />
            <Divider />
            <Row label="Withdrawal fee" value="10%" sub="Deducted from every withdrawal" />
          </div>

          {/* Daily ads requirement */}
          {!eligibilityLoading && !adsOk && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 14, padding: '12px 14px', marginBottom: 14,
            }}>
              <AlertTriangle size={17} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fbbf24', fontSize: 12.5, fontWeight: 800, marginBottom: 3 }}>
                  Complete today's ads to unlock withdrawals
                </div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11.5, lineHeight: 1.5, marginBottom: 8 }}>
                  {eligibility?.adsCompletedToday ?? 0}/{eligibility?.adsRequiredToday ?? 30} daily ads completed today.
                </div>
                <button
                  onClick={() => { onClose(); setLocation('/earn'); }}
                  style={{
                    border: 'none', borderRadius: 10, padding: '7px 14px',
                    background: 'linear-gradient(135deg, #d97706, #f59e0b)',
                    color: '#fff', fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
                  }}
                >
                  Go watch ads
                </button>
              </div>
            </div>
          )}

          {/* One request per day */}
          {!eligibilityLoading && adsOk && alreadyWithdrawnToday && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 14, padding: '12px 14px', marginBottom: 14,
            }}>
              <XCircle size={17} color="#f87171" style={{ flexShrink: 0 }} />
              <div style={{ color: '#fca5a5', fontSize: 12, fontWeight: 700 }}>
                You've already submitted a withdrawal request today. Try again tomorrow.
              </div>
            </div>
          )}

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
                placeholder="Enter AXN amount"
                disabled={isProcessing}
                style={{
                  flex: 1, padding: '14px 0', background: 'none', border: 'none', outline: 'none',
                  color: '#fff', fontSize: 16, fontWeight: 700,
                }}
              />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: 700 }}>AXN</span>
            </div>

            {amtNum > 0 && (
              <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 11, marginTop: 7 }}>
                Fee (10%): {fee.toLocaleString(undefined, { maximumFractionDigits: 4 })} AXN · You'll receive: {netAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} AXN
              </div>
            )}
            {amtNum > 0 && amtNum < minWithdrawal && (
              <div style={{ color: '#f87171', fontSize: 11, marginTop: 5 }}>Minimum {minWithdrawal.toLocaleString()} AXN required</div>
            )}
            {maxWithdrawal !== null && amtNum > maxWithdrawal && (
              <div style={{ color: '#f87171', fontSize: 11, marginTop: 5 }}>Maximum {maxWithdrawal.toLocaleString()} AXN per day</div>
            )}
            {amtNum > userBalance && amtNum > 0 && (
              <div style={{ color: '#f87171', fontSize: 11, marginTop: 5 }}>Insufficient balance</div>
            )}
          </div>

          {/* Submit */}
          <button
            onClick={() => submitMutation.mutate()}
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
            {isProcessing ? 'Submitting…' : 'Submit Withdrawal Request'}
          </button>
          <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10.5, textAlign: 'center', lineHeight: 1.5, marginTop: 10 }}>
            Requests are reviewed and sent manually by the admin. You'll be notified once it's approved.
          </div>
        </>
      )}
    </PopupShell>
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
      <span style={{ color: valueColor || '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />;
}

function SuccessView({ net, fee, onClose }: { net: number; fee: number; onClose: () => void }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: 60, height: 60, borderRadius: '50%', margin: '0 auto 16px',
        background: 'linear-gradient(135deg, rgba(37,99,235,0.2), rgba(59,130,246,0.1))',
        border: '1px solid rgba(37,99,235,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <CheckCircle2 size={28} color="#4ade80" />
      </div>
      <div style={{ color: '#fff', fontSize: 16, fontWeight: 900, marginBottom: 8 }}>Request Submitted</div>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1.55, marginBottom: 18 }}>
        Your withdrawal is pending admin review. You'll receive a notification once it's approved and sent.
      </div>
      <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, marginBottom: 18, overflow: 'hidden' }}>
        <Row label="Fee (10%)" value={`${fee.toLocaleString(undefined, { maximumFractionDigits: 4 })} AXN`} />
        <Divider />
        <Row label="You'll receive" value={`${net.toLocaleString(undefined, { maximumFractionDigits: 4 })} AXN`} valueColor="#4ade80" />
      </div>
      <button
        onClick={onClose}
        className="active:scale-95 transition-transform"
        style={{
          width: '100%', padding: '14px 0', border: 'none', borderRadius: 14, cursor: 'pointer',
          background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
          color: '#fff', fontSize: 14, fontWeight: 800,
          boxShadow: '0 2px 16px rgba(37,99,235,0.35)',
        }}
      >
        Done
      </button>
    </div>
  );
}
