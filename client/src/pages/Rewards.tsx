import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import MenuPopup from "@/components/MenuPopup";
import PopupShell from "@/components/PopupShell";
import Header from "@/components/Header";
import { showRewardedInterstitial } from "@/lib/showAd";
import { MACHINE_TYPES } from "../../../shared/machineTypes";

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

type MysteryPhase = 'idle' | 'opening' | 'revealed' | 'claiming' | 'done';

function fmtCountdown(secs: number): string {
  if (secs <= 0) return "Expired";
  const days = Math.floor(secs / 86_400);
  const hours = Math.floor((secs % 86_400) / 3_600);
  const minutes = Math.floor((secs % 3_600) / 60);
  const unit = (value: number, singular: string) => `${value} ${singular}${singular === 'Min' || value === 1 ? '' : 's'}`;

  if (days > 0) {
    if (hours > 0) return `${unit(days, 'Day')} ${unit(hours, 'Hour')}`;
    if (minutes > 0) return `${unit(days, 'Day')} ${unit(minutes, 'Min')}`;
    return unit(days, 'Day');
  }
  if (hours > 0) {
    return minutes > 0 ? `${unit(hours, 'Hour')} ${unit(minutes, 'Min')}` : unit(hours, 'Hour');
  }
  return unit(Math.max(1, minutes), 'Min');
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.00$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtGram(n: number): string {
  return (n / 100_000).toFixed(6);
}

function getMachineUnclaimed(machine: any, machineType: any, now: number): number {
  const lastClaimed = new Date(machine.lastClaimedAt || machine.purchasedAt).getTime();
  const expiresAt = new Date(machine.expiresAt).getTime();
  const effectiveNow = Math.min(now, expiresAt);
  if (effectiveNow <= lastClaimed) return 0;
  return Math.floor(((effectiveNow - lastClaimed) / 3_600_000) * machineType.hourlyAxn);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function getMachineStatus(remainingSeconds: number): { label: string; color: string } {
  if (remainingSeconds <= 0) return { label: 'Expired', color: 'rgba(255,255,255,0.35)' };
  if (remainingSeconds <= 3600) return { label: 'Ending Soon', color: '#facc15' };
  return { label: 'Active', color: '#4ade80' };
}

const CLAIM_WINDOW_MS = 12 * 3_600_000;

// Rewards accrue continuously off lastClaimedAt regardless of this window —
// this is purely a reminder to the user, never a cap, pause, or reset.
function getClaimWindow(machine: any, now: number): { overdue: boolean; hoursSinceClaim: number } {
  const lastClaimed = new Date(machine.lastClaimedAt || machine.purchasedAt).getTime();
  const hoursSinceClaim = Math.max(0, (now - lastClaimed) / 3_600_000);
  return { overdue: now - lastClaimed >= CLAIM_WINDOW_MS, hoursSinceClaim };
}

function NFTDetailsSheet({
  machineType,
  machines,
  now,
  onClose,
}: {
  machineType: any;
  machines: any[];
  now: number;
  onClose: () => void;
}) {
  const sortedMachines = [...machines].sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedMachine = sortedMachines[selectedIndex];

  if (!selectedMachine) return null;

  const expiresAt = new Date(selectedMachine.expiresAt).getTime();
  const remainingSeconds = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const status = getMachineStatus(remainingSeconds);
  const currentReward = getMachineUnclaimed(selectedMachine, machineType, now);
  const claimWindow = getClaimWindow(selectedMachine, now);
  const showClaimReminder = remainingSeconds > 0 && claimWindow.overdue;

  return (
    <PopupShell onClose={onClose} maxWidth={430} zIndex={1100}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: '#16181d' }}>
            <img
              src={machineType.imageUrl}
              alt={machineType.name}
              style={{
                width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                objectPosition: machineType.imagePosition ?? '50% 50%',
                transform: `scale(${machineType.imageZoom ?? 1})`, transformOrigin: 'center center',
              }}
            />
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 17, fontWeight: 900 }}>{machineType.name}</div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>
              {machines.length} purchase plan{machines.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: '14px 16px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 700 }}>
              NFT {selectedIndex + 1} of {sortedMachines.length}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '0.03em', color: status.color,
              background: status.color === '#4ade80' ? 'rgba(74,222,128,0.12)' : status.color === '#facc15' ? 'rgba(250,204,21,0.12)' : 'rgba(255,255,255,0.06)',
              borderRadius: 20, padding: '3px 9px',
            }}>
              {status.label.toUpperCase()}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>Purchase time</span>
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>{fmtDateTime(selectedMachine.purchasedAt)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>Expiry time</span>
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>{fmtDateTime(selectedMachine.expiresAt)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: showClaimReminder ? 8 : 0, marginBottom: showClaimReminder ? 8 : 0, borderBottom: showClaimReminder ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>Current reward</span>
            <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 800 }}>{fmtNum(currentReward)} AXN</span>
          </div>
          {showClaimReminder && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#facc15', fontSize: 11 }}>⏰ Claim overdue</span>
              <span style={{ color: '#facc15', fontSize: 11, fontWeight: 700 }}>{Math.floor(claimWindow.hoursSinceClaim)}h since last claim</span>
            </div>
          )}
        </div>

        {sortedMachines.length > 1 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <button
              onClick={() => setSelectedIndex(index => Math.max(0, index - 1))}
              disabled={selectedIndex === 0}
              style={{ flex: 1, padding: '11px 0', border: '1px solid rgba(255,255,255,0.08)', background: selectedIndex === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(37,99,235,0.12)', color: selectedIndex === 0 ? 'rgba(255,255,255,0.2)' : '#93c5fd', fontSize: 12, fontWeight: 800, cursor: selectedIndex === 0 ? 'not-allowed' : 'pointer', clipPath: 'polygon(8px 0%,calc(100% - 8px) 0%,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0% calc(100% - 8px),0% 8px)' }}
            >
              ← Previous
            </button>
            <button
              onClick={() => setSelectedIndex(index => Math.min(sortedMachines.length - 1, index + 1))}
              disabled={selectedIndex === sortedMachines.length - 1}
              style={{ flex: 1, padding: '11px 0', border: '1px solid rgba(255,255,255,0.08)', background: selectedIndex === sortedMachines.length - 1 ? 'rgba(255,255,255,0.03)' : 'rgba(37,99,235,0.12)', color: selectedIndex === sortedMachines.length - 1 ? 'rgba(255,255,255,0.2)' : '#93c5fd', fontSize: 12, fontWeight: 800, cursor: selectedIndex === sortedMachines.length - 1 ? 'not-allowed' : 'pointer', clipPath: 'polygon(8px 0%,calc(100% - 8px) 0%,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0% calc(100% - 8px),0% 8px)' }}
            >
              Next →
            </button>
          </div>
        )}

        <button onClick={onClose} style={{ width: '100%', padding: '12px 0', marginTop: 4, background: 'rgba(255,255,255,0.06)', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 800, cursor: 'pointer', clipPath: 'polygon(8px 0%,calc(100% - 8px) 0%,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0% calc(100% - 8px),0% 8px)' }} className="active:scale-95 transition-transform">Close</button>
    </PopupShell>
  );
}

function FarmingCard({
  machineType,
  machines,
  now,
}: {
  machineType: any;
  machines: any[];
  now: number;
}) {
  const queryClient = useQueryClient();
  const [showDetails, setShowDetails] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const activeMachines = machines.filter(machine => new Date(machine.expiresAt).getTime() > now);
  const level = Math.min(machines.length, 10);
  const hourlyEarnings = level * machineType.hourlyAxn;
  const dailyEarnings = hourlyEarnings * 24;
  const totalUnclaimed = machines.reduce((sum, machine) => sum + getMachineUnclaimed(machine, machineType, now), 0);
  const remainingSeconds = activeMachines.length > 0
    ? Math.max(0, Math.floor((Math.min(...activeMachines.map(machine => new Date(machine.expiresAt).getTime())) - now) / 1000))
    : 0;
  const claimOverdue = activeMachines.some(machine => getClaimWindow(machine, now).overdue);

  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/machines/claim', { machineType: machineType.id });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to claim');
      return data;
    },
    onSuccess: (data) => {
      showNotification(`${machineType.name} rewards claimed! +${data.amount} AXN`, 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/machines'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
    },
    onError: (err: any) => showNotification(err?.message || 'Failed to claim rewards', 'error'),
  });

  return (
    <>
    <div
      style={{
        background: 'rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden',
        marginBottom: 12, opacity: activeMachines.length > 0 ? 1 : 0.58,
      }}
    >
      {/* Header: NFT identity on the left, remaining time on the right */}
      <div
        onClick={() => setShowDetails(true)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 14px 18px', cursor: 'pointer' }}
        className="active:scale-[0.99] transition-transform"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ width: 50, height: 50, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: '#16181d' }}>
            <img
              src={machineType.imageUrl}
              alt={machineType.name}
              loading="lazy"
              decoding="async"
              style={{
                width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                objectPosition: machineType.imagePosition ?? '50% 50%',
                transform: `scale(${machineType.imageZoom ?? 1})`, transformOrigin: 'center center',
              }}
            />
          </div>
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {machineType.name}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Level {level}/10
            </div>
          </div>
        </div>
        <div style={{ flexShrink: 0, textAlign: 'right', paddingLeft: 8 }}>
           <div style={{ color: '#fff', fontSize: 10, fontWeight: 700, marginBottom: 4, whiteSpace: 'nowrap' }}>
            Remaining Time
          </div>
           <div style={{ color: claimOverdue ? '#ef4444' : 'rgba(255,255,255,0.42)', fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {fmtCountdown(remainingSeconds)}
          </div>
        </div>
      </div>

      {/* Two-column earnings */}
      <div style={{ padding: '0 14px 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <div>
            <div style={{ color: '#fff', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Hourly Earnings</div>
            <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{hourlyEarnings.toLocaleString(undefined, { maximumFractionDigits: 2 })} AXN/hr</div>
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Daily Earnings</div>
            <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{dailyEarnings.toLocaleString(undefined, { maximumFractionDigits: 2 })} AXN/day</div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

      {/* Sub-row: Info | Claim | Warning */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <button
          onClick={(e) => { e.stopPropagation(); setShowDetails(true); }}
          style={{ flex: 1, padding: '11px 0', background: 'none', border: 'none', color: 'rgba(255,255,255,0.38)', fontSize: 15, fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          className="active:scale-95 transition-transform"
        >
          ?
        </button>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.05)' }} />
        {claimMutation.isPending ? (
          <button disabled style={{ flex: 3, padding: '11px 0', background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'default' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.4)', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
            Claiming…
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); totalUnclaimed >= 1 && claimMutation.mutate(); }}
            disabled={totalUnclaimed < 1}
             style={{
               flex: 3, padding: '11px 0', border: 'none',
               background: totalUnclaimed >= 1 ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'rgba(255,255,255,0.06)',
               cursor: totalUnclaimed >= 1 ? 'pointer' : 'not-allowed',
               display: 'flex', alignItems: 'center', justifyContent: 'center',
               color: totalUnclaimed >= 1 ? '#fff' : 'rgba(255,255,255,0.3)',
               fontSize: 12, fontWeight: 800, letterSpacing: '0.05em',
               boxShadow: totalUnclaimed >= 1 ? '0 2px 12px rgba(37,99,235,0.35)' : 'none',
             }}
             className={totalUnclaimed >= 1 ? "active:scale-95 transition-transform" : ""}
          >
            {totalUnclaimed >= 1 ? `CLAIM ${fmtNum(totalUnclaimed)} AXN` : 'CLAIM'}
          </button>
        )}
        <div style={{ width: 1, background: 'rgba(255,255,255,0.05)' }} />
        <button
          onClick={(e) => { e.stopPropagation(); setShowWarning(true); }}
          style={{ flex: 1, padding: '11px 0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          className="active:scale-95 transition-transform"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </button>
      </div>
    </div>

    {showDetails && (
      <NFTDetailsSheet
        machineType={machineType}
        machines={machines}
        now={now}
        onClose={() => setShowDetails(false)}
      />
    )}

    {showWarning && (
      <PopupShell onClose={() => setShowWarning(false)} maxWidth={430} zIndex={1100}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={claimOverdue ? '#facc15' : 'rgba(255,255,255,0.5)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginBottom: 10 }}>
              {claimOverdue ? 'Claim Overdue' : 'All Good'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
              {claimOverdue
                ? `It's been over 12 hours since you last claimed ${machineType.name} rewards. Rewards keep accumulating, but claiming regularly is your responsibility — the plan itself never pauses or resets.`
                : `${machineType.name} is running on schedule. Rewards accumulate continuously — remember to claim within 12 hours.`}
            </div>
            <button onClick={() => setShowWarning(false)} style={{ width: '100%', padding: '14px 0', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 800, cursor: 'pointer' }} className="active:scale-95 transition-transform">OK</button>
          </div>
      </PopupShell>
    )}
    </>
  );
}

export default function Rewards() {
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dailyChecked, setDailyChecked] = useState(() => localStorage.getItem('daily_check_date') === getTodayKey());
  const [dailyAdLoading, setDailyAdLoading] = useState(false);
  const [mysteryClaimsToday, setMysteryClaimsToday] = useState(0);
  const MYSTERY_DAILY_LIMIT = 5;
  const mysteryOpened = mysteryClaimsToday >= MYSTERY_DAILY_LIMIT;

  const [mysteryPhase, setMysteryPhase] = useState<MysteryPhase>('idle');
  const [mysteryReward, setMysteryReward] = useState(0);
  const mysteryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [now, setNow] = useState(() => Date.now());

  const queryClient = useQueryClient();

  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], staleTime: 0 });

  useEffect(() => {
    if (!user) return;
    const todayKey = getTodayKey();
    if (user.dailyCheckinClaimed && user.dailyTasksDate) {
      const serverDate = new Date(user.dailyTasksDate).toISOString().slice(0, 10);
      if (serverDate === todayKey) {
        setDailyChecked(true);
        localStorage.setItem('daily_check_date', todayKey);
      } else {
        setDailyChecked(false);
        localStorage.removeItem('daily_check_date');
      }
    } else if (!user.dailyCheckinClaimed) {
      setDailyChecked(false);
      localStorage.removeItem('daily_check_date');
    }
    if (user.mysteryBoxDate) {
      const serverDate = new Date(user.mysteryBoxDate).toISOString().slice(0, 10);
      setMysteryClaimsToday(serverDate === todayKey ? (user.mysteryBoxCount ?? 0) : 0);
    } else {
      setMysteryClaimsToday(0);
    }
  }, [user]);

  const dailyCheckMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/daily-checkin', {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      return data;
    },
    onSuccess: (data) => {
      setDailyChecked(true);
      localStorage.setItem('daily_check_date', getTodayKey());
      showNotification(`Daily check-in done! +${data.reward ?? 0.001} GRAM added`, 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Daily check-in failed. Try again.', 'error');
    },
  });

  const handleDailyCheck = async () => {
    if (dailyChecked || dailyAdLoading || dailyCheckMutation.isPending) return;
    setDailyAdLoading(true);
    try {
      await showRewardedInterstitial();
      dailyCheckMutation.mutate();
    } catch {
      showNotification('Ad was not completed. Daily check-in reward was not granted.', 'error');
    } finally {
      setDailyAdLoading(false);
    }
  };

  const handleMysteryOpen = async () => {
    if (mysteryOpened || mysteryPhase !== 'idle') return;
    setMysteryPhase('opening');
    if (mysteryTimerRef.current) clearTimeout(mysteryTimerRef.current);

    let serverReward = 0;
    // Unlock requires watching 2 ads
    try { await showRewardedInterstitial(); } catch {}
    try { await showRewardedInterstitial(); } catch {}
    try {
      const res = await apiRequest('POST', '/api/mystery-box', {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      serverReward = data.reward ?? 0;
      setMysteryReward(serverReward);
      if (typeof data.claimsToday === 'number') setMysteryClaimsToday(data.claimsToday);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    } catch (err: any) {
      setMysteryPhase('idle');
      showNotification(err?.message || 'Failed to open mystery box. Try again.', 'error');
      return;
    }

    mysteryTimerRef.current = setTimeout(() => {
      setMysteryPhase('revealed');
    }, 2200);
  };

  const handleMysteryClaim = () => {
    if (mysteryPhase !== 'revealed') return;
    showNotification(`Mystery Gift! You won ${mysteryReward} GRAM!`, 'success');
    setMysteryPhase('done');
    mysteryTimerRef.current = setTimeout(() => setMysteryPhase('idle'), 1800);
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { data: machineData } = useQuery<any>({
    queryKey: ['/api/machines'],
    staleTime: 10000,
    refetchInterval: 30000,
  });
  const machines: any[] = machineData?.machines || [];
  const machinesByType = machines.reduce<Record<string, any[]>>((groups, machine) => {
    (groups[machine.machineType] ||= []).push(machine);
    return groups;
  }, {});
  const ownedMachineTypes = MACHINE_TYPES.filter(machineType => machinesByType[machineType.id]?.length);

  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/machines/claim', {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to claim');
      return data;
    },
    onSuccess: (data) => {
      showNotification(`Farming rewards claimed! +${data.amount} AXN`, 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/machines'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
    },
    onError: (err: any) => showNotification(err?.message || 'Failed to claim farming rewards', 'error'),
  });

  const totalHourlyRate = ownedMachineTypes.reduce((sum, machineType) => (
    sum + (machinesByType[machineType.id] || []).filter(machine => new Date(machine.expiresAt).getTime() > now).length * machineType.hourlyAxn
  ), 0);
  // The legacy markup below is hidden and intentionally disconnected from the API.
  const farmData = { isActive: false };
  const farmStartMutation = { isPending: false, mutate: () => undefined };
  const farmClaimMutation = claimMutation;
  const farmCountdown = 0;
  const farmAccum = 0;
  const [showFarmInfo, setShowFarmInfo] = useState(false);
  const [showAlertPopup, setShowAlertPopup] = useState(false);
  return (
    <div style={{ height: '100dvh', background: '#0a0a0a', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes boxPulse {
          0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(37,99,235,0.4); }
          50% { transform: scale(1.06); box-shadow: 0 0 0 14px rgba(37,99,235,0); }
        }
        @keyframes rewardIn {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <Header onMenuOpen={() => setMenuOpen(true)} />

      {/* Scrollable Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '8px clamp(12px, 4vw, 20px)', paddingTop: 'calc(var(--header-height, 62px) + 14px)', paddingBottom: 'max(90px, calc(env(safe-area-inset-bottom, 0px) + 90px))', width: '100%' }}>

        {/* DAILY REWARDS */}
        <div style={{ marginBottom: 10 }}>
             <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px' }}>
            <span style={{ color: '#fff' }}>Daily </span>
            <span style={{ color: '#3b82f6' }}>Rewards</span>
          </span>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 3 }}>Complete daily tasks and get rewards.</div>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.07)', borderRadius: 14,
          marginBottom: 20, overflow: 'hidden',
        }}>
          {/* Daily Check-In */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
              <polyline points="9 16 11 18 15 14"/>
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>Daily Check-In</div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>Earn 0.001 GRAM</div>
            </div>
            <button
              onClick={handleDailyCheck}
              disabled={dailyChecked || dailyAdLoading || dailyCheckMutation.isPending}
              style={{
                background: dailyChecked ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                color: dailyChecked ? 'rgba(255,255,255,0.3)' : '#fff',
                border: 'none',
                borderRadius: 10, padding: '9px 16px', fontSize: 12, fontWeight: 800,
                cursor: (dailyChecked || dailyAdLoading) ? 'not-allowed' : 'pointer',
                flexShrink: 0, letterSpacing: '0.03em',
                boxShadow: dailyChecked ? 'none' : '0 2px 12px rgba(37,99,235,0.4)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
              className="active:scale-95 transition-transform"
            >
              {(dailyAdLoading || dailyCheckMutation.isPending) ? (
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              ) : dailyChecked ? 'DONE' : 'CHECK'}
            </button>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />

          {/* Mystery Box */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>Mystery Gift</div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>
                Win 0.00001–0.01 GRAM · Watch 2 ads · {Math.max(0, MYSTERY_DAILY_LIMIT - mysteryClaimsToday)}/{MYSTERY_DAILY_LIMIT} left today
              </div>
            </div>
            <button
              onClick={handleMysteryOpen}
              disabled={mysteryOpened || mysteryPhase !== 'idle'}
              style={{
                background: mysteryOpened ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                color: mysteryOpened ? 'rgba(255,255,255,0.3)' : '#fff',
                border: 'none',
                borderRadius: 10, padding: '9px 16px', fontSize: 12, fontWeight: 800,
                cursor: mysteryOpened ? 'not-allowed' : 'pointer', flexShrink: 0,
                boxShadow: mysteryOpened ? 'none' : '0 2px 12px rgba(37,99,235,0.4)',
              }}
              className="active:scale-95 transition-transform"
            >
              {mysteryOpened ? 'DONE' : 'OPEN'}
            </button>
          </div>
        </div>

        {/* MY NFTS label */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
             <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px' }}>
              <span style={{ color: '#fff' }}>My </span>
              <span style={{ color: '#3b82f6' }}>NFTs</span>
            </span>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 3 }}>
              Rewards are generated only by NFTs you own.
            </div>
          </div>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 800, flexShrink: 0, whiteSpace: 'nowrap', textAlign: 'right' }}>
            ({fmtGram(totalHourlyRate)} GRAM) • {fmtNum(totalHourlyRate)} AXN/hr
          </div>
        </div>

        {ownedMachineTypes.length === 0 ? (
          <div style={{
            background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.12)',
            borderRadius: 16, padding: '28px 20px', marginBottom: 20, textAlign: 'center',
          }}>
            <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>You don't own any NFTs yet.</div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, lineHeight: 1.5, marginTop: 7 }}>
              Purchase an NFT on the Marketplace to start farming AXN.
            </div>
            <button
              onClick={() => setLocation('/machine')}
              style={{
                marginTop: 18, padding: '11px 22px',
                background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                color: '#fff', border: 'none', borderRadius: 12,
                fontSize: 13, fontWeight: 800, letterSpacing: '0.02em', cursor: 'pointer',
                boxShadow: '0 2px 12px rgba(37,99,235,0.4)',
              }}
              className="active:scale-95 transition-transform"
            >
              Purchase NFT
            </button>
          </div>
        ) : (
          <>
            {ownedMachineTypes.map(machineType => (
              <FarmingCard
                key={machineType.id}
                machineType={machineType}
                machines={machinesByType[machineType.id]}
                now={now}
              />
            ))}
          </>
        )}

        {/* FARMING */}
        <div style={{ display: 'none', background: 'rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
          {/* Main row: coin + counting */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px' }}>
            <div style={{
              width: 50, height: 50, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: '#000',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <img src="/axn-coin.jpg" alt="AXN" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              {(() => {
                const val = farmAccum.toFixed(3);
                const [intPart, decPart] = val.split('.');
                return (
                  <div style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
                    <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 'clamp(24px, 8vw, 36px)', fontWeight: 800 }}>{intPart}</span>
                    <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 'clamp(16px, 5vw, 22px)', fontWeight: 700 }}>.{decPart}</span>
                    <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, fontWeight: 600, marginLeft: 5 }}>AXN</span>
                  </div>
                );
              })()}
              <div style={{ color: 'rgba(255,255,255,0.32)', fontSize: 12, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>NFT-owned farming rewards</div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

          {/* Sub-row: Info | Start/Claim/Cooldown | Alert */}
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <button onClick={() => setShowFarmInfo(true)} style={{ flex: 1, padding: '11px 0', background: 'none', border: 'none', color: 'rgba(255,255,255,0.38)', fontSize: 15, fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="active:scale-95 transition-transform">?</button>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.05)' }} />
            {(() => {
              const isActive = farmData?.isActive;
              const isPending = farmStartMutation.isPending || farmClaimMutation.isPending;
              if (isPending) return (
                <button disabled style={{ flex: 3, padding: '11px 0', background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, color: 'rgba(255,255,255,0.28)', fontSize: 12, fontWeight: 700, cursor: 'default' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.4)', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                  {farmClaimMutation.isPending ? 'Claiming…' : 'Starting…'}
                </button>
              );
              if (isActive && farmCountdown <= 0) return (
                <button onClick={() => farmClaimMutation.mutate()} style={{ flex: 3, padding: '11px 0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }} className="active:scale-95 transition-transform">
                  CLAIM
                </button>
              );
              if (isActive) return (
                <div style={{ flex: 3, padding: '11px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 700 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCountdown(farmCountdown)}</span>
                </div>
              );
              return (
                <button onClick={() => farmStartMutation.mutate()} style={{ flex: 3, padding: '11px 0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }} className="active:scale-95 transition-transform">
                  START
                </button>
              );
            })()}
            <div style={{ width: 1, background: 'rgba(255,255,255,0.05)' }} />
            <button onClick={() => setShowAlertPopup(true)} style={{ flex: 1, padding: '11px 0', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="active:scale-95 transition-transform">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Farm Info Popup — bottom sheet */}
        {showFarmInfo && (
          <PopupShell onClose={() => setShowFarmInfo(false)} maxWidth={430} zIndex={1100}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', background: '#000', flexShrink: 0 }}>
                  <img src="/axn-coin.jpg" alt="AXN" style={{ width: '110%', height: '110%', objectFit: 'cover' }} />
                </div>
                <div>
                  <div style={{ color: '#fff', fontSize: 17, fontWeight: 900 }}>Farming Info</div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>How it works</div>
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: '4px 0', marginBottom: 20 }}>
                {[
                  { label: 'Mining speed', val: '0.001 AXN/s' },
                  { label: 'Cycle duration', val: '4 hours' },
                  { label: 'Rewards', val: 'NFT-owned only' },
                  { label: 'Claim anytime', val: 'Yes' },
                  { label: 'Auto-stop', val: 'After 4 hours' },
                ].map((r, i, arr) => (
                  <div key={r.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{r.label}</span>
                      <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{r.val}</span>
                    </div>
                    {i < arr.length - 1 && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />}
                  </div>
                ))}
              </div>
              <button onClick={() => setShowFarmInfo(false)} style={{ width: '100%', padding: '14px 0', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 800, cursor: 'pointer' }} className="active:scale-95 transition-transform">Got it</button>
          </PopupShell>
        )}

        {/* Alert Popup — bottom sheet */}
        {showAlertPopup && (
          <PopupShell onClose={() => setShowAlertPopup(false)} maxWidth={430} zIndex={1100}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
                <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Coming Soon</div>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
                  This feature is coming soon. Stay tuned for updates!
                </div>
                <button onClick={() => setShowAlertPopup(false)} style={{ width: '100%', padding: '14px 0', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 800, cursor: 'pointer' }} className="active:scale-95 transition-transform">OK</button>
              </div>
          </PopupShell>
        )}

      </div>

      {/* Mystery Box Popup */}
      {mysteryPhase !== 'idle' && (
        <PopupShell onClose={() => mysteryPhase === 'done' && setMysteryPhase('idle')} maxWidth={340} zIndex={950} closeOnBackdrop={mysteryPhase === 'done'}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
              {mysteryPhase === 'opening' && (
                <div style={{
                  width: 82, height: 82, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: 'boxPulse 0.65s ease-in-out infinite',
                }}>
                  <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                    <line x1="12" y1="22.08" x2="12" y2="12"/>
                  </svg>
                </div>
              )}
              {(mysteryPhase === 'revealed' || mysteryPhase === 'claiming') && (
                <div style={{ animation: 'rewardIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }}>
                  <div style={{ fontSize: 52, fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '-2px' }}>{mysteryReward}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#3b82f6', marginTop: 6 }}>GRAM</div>
                </div>
              )}
              {mysteryPhase === 'done' && (
                <div style={{ animation: 'rewardIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }}>
                  <svg width="68" height="68" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
              )}
            </div>

            <div style={{ color: '#fff', fontSize: 18, fontWeight: 900, marginBottom: 6 }}>
              {mysteryPhase === 'opening' ? 'Opening box...'
                : mysteryPhase === 'revealed' ? `You won ${mysteryReward} GRAM!`
                : mysteryPhase === 'claiming' ? 'Claiming...'
                : 'Reward Claimed!'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.32)', fontSize: 13, marginBottom: 28 }}>
              {mysteryPhase === 'opening' ? 'Wait for your prize...'
                : mysteryPhase === 'revealed' ? 'Tap below to claim your GRAM'
                : mysteryPhase === 'claiming' ? 'Please wait...'
                : 'GRAM added to your balance'}
            </div>

            {mysteryPhase === 'revealed' && (
              <button onClick={handleMysteryClaim} style={{
                width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                border: 'none', borderRadius: 50, color: '#fff',
                fontSize: 14, fontWeight: 800, cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(37,99,235,0.4)',
              }} className="active:scale-95 transition-transform">
                Claim {mysteryReward} GRAM
              </button>
            )}
            {(mysteryPhase === 'opening' || mysteryPhase === 'claiming') && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(59,130,246,0.3)', borderTopColor: '#3b82f6', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Please wait</span>
              </div>
            )}
          </div>
        </PopupShell>
      )}

      {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
