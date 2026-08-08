import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, Play } from "lucide-react";
import Header from "@/components/Header";
import MenuPopup from "@/components/MenuPopup";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { showMonatagRewardedAd, showAdgramAd, showGigapubAd } from "@/lib/showAd";
import { TonIcon } from "@/components/TonIcon";

const BLUE = '#3b82f6';
const BLUE_D = '#2563eb';
const CARD = 'rgba(255,255,255,0.07)';
const TEXT = '#fff';
const TEXT_DIM = 'rgba(255,255,255,0.35)';

type AdProvider = 'Monetag' | 'AdsGram' | 'Gigapub';
type ProviderKey = 'Monetag' | 'AdsGram' | 'Gigapub';
type ProviderStatus = {
  slot: number;
  reward: number;
  dailyLimit: number;
  watched: number;
  remaining: number;
  resetAt: string;
  resetMs: number;
};
type ProviderStatusMap = Partial<Record<ProviderKey, ProviderStatus>>;
type EarnTab = 'ads' | 'social' | 'partner' | 'bot';

const AD_TASKS: { slotId: number; provider: AdProvider; statusKey: ProviderKey; reward: number; dailyLimit: number }[] = [
  { slotId: 2, provider: 'AdsGram', statusKey: 'AdsGram', reward: 0.007, dailyLimit: 10 },
  { slotId: 1, provider: 'Monetag', statusKey: 'Monetag', reward: 0.005, dailyLimit: 10 },
  { slotId: 3, provider: 'Gigapub', statusKey: 'Gigapub', reward: 0.005, dailyLimit: 10 },
];
async function runAdForProvider(provider: AdProvider): Promise<void> {
  if (provider === 'Monetag') await showMonatagRewardedAd();
  else if (provider === 'AdsGram') await showAdgramAd();
  else await showGigapubAd();
}
const PROVIDER_LOGOS: Record<AdProvider, string> = {
  Monetag: '/monetag-logo.jpg',
  AdsGram: '/adsgram-logo.jpg',
  Gigapub: '/gigapub-logo.jpg',
};
const providerStatusKey = ['/api/ads/provider-status'];

function updateProviderCache(
  queryClient: ReturnType<typeof useQueryClient>,
  statusKey: ProviderKey,
  next: Partial<ProviderStatus>,
) {
  queryClient.setQueryData(providerStatusKey, (old: { providers?: ProviderStatusMap } | undefined) => {
    if (!old?.providers?.[statusKey]) return old;
    return { ...old, providers: { ...old.providers, [statusKey]: { ...old.providers[statusKey], ...next } } };
  });
}

function AdProviderRow({
  slotId, provider, statusKey, reward, dailyLimit, status, isLast,
}: {
  slotId: number; provider: AdProvider; statusKey: ProviderKey; reward: number; dailyLimit: number;
  status?: ProviderStatus; isLast: boolean;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'claiming'>('idle');
  const queryClient = useQueryClient();
  const remaining = status?.remaining ?? dailyLimit;
  const done = remaining <= 0;
  const busy = state !== 'idle';

  const handleWatch = async () => {
    if (busy || done) return;
    setState('loading');
    try {
      await runAdForProvider(provider);
    } catch {
      setState('idle');
      showNotification('Ad did not complete. No reward was given.', 'error');
      return;
    }

    setState('claiming');
    try {
      const res = await apiRequest('POST', '/api/ads/slot-watch', { slot: slotId });
      const data = await res.json();
      const earned = Number(data.rewardGram ?? reward);
      const nextWatched = Number(data.currentCount ?? (status?.watched ?? 0) + 1);
      updateProviderCache(queryClient, statusKey, {
        watched: nextWatched,
        remaining: Math.max(0, dailyLimit - nextWatched),
        resetMs: Number(data.cooldownMs ?? status?.resetMs ?? 0),
      });
      queryClient.setQueryData(['/api/auth/user'], (old: any) => {
        if (!old) return old;
        return { ...old, balance: String(parseFloat(old.balance || '0') + earned) };
      });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      showNotification(`+${earned.toLocaleString(undefined, { maximumFractionDigits: 6 })} GRAM earned!`, 'success');
    } catch (error: any) {
      let message = 'Failed to claim. Try again.';
      try { const parsed = JSON.parse(error.message); if (parsed.message) message = parsed.message; } catch {}
      queryClient.invalidateQueries({ queryKey: providerStatusKey });
      showNotification(message, 'error');
    } finally {
      setState('idle');
    }
  };

  return (
    <div style={{
      width: '100%', borderRadius: 18, overflow: 'hidden',
      marginBottom: 0, background: '#1a1a1a',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, flexShrink: 0,
          overflow: 'hidden', background: 'rgba(59,130,246,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img
            src={PROVIDER_LOGOS[provider]}
            alt={provider}
            width={48}
            height={48}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: done ? 'grayscale(0.8)' : 'none' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, lineHeight: 1.3, marginBottom: 2 }}>Sponsored by</div>
          <div style={{ color: TEXT, fontSize: 15, lineHeight: 1.2, fontWeight: 800 }}>{provider}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 2 }}>AD LIMIT</div>
          <div style={{ color: done ? 'rgba(239,68,68,0.85)' : 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: 800 }}>
            {status?.watched ?? 0}<span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 500 }}>/{dailyLimit}</span>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 12px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 3 }}>REWARD</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {reward.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              <TonIcon size={15} />
            </span>
          </div>
        </div>

        <button
          onClick={handleWatch}
          disabled={busy || done}
          data-testid={`button-watch-${provider.toLowerCase()}`}
          style={{
            padding: '9px 16px', borderRadius: 12, minWidth: 108, height: 42,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            fontSize: 12, fontWeight: 700, border: 'none', cursor: busy || done ? 'default' : 'pointer',
            letterSpacing: '0.02em', whiteSpace: 'nowrap',
            background: done || busy ? 'rgba(255,255,255,0.06)' : '#3b82f6',
            color: done || busy ? 'rgba(255,255,255,0.3)' : '#fff',
          }}
          className="active:scale-95 transition-transform disabled:active:scale-100"
        >
          {busy
            ? <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'spin .7s linear infinite' }} />
            : done ? <Check size={13} /> : <Play size={12} fill="currentColor" />}
          {busy ? 'Loading' : done ? 'Limit Reached' : 'Watch Ad'}
        </button>
      </div>
    </div>
  );
}

function AxnNameTaskDaily({ claimedToday }: { claimedToday: boolean }) {
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(claimedToday);
  const [state, setState] = useState<'idle' | 'checking'>('idle');
  const queryClient = useQueryClient();

  if (done) return null;

  const handleCopy = () => { navigator.clipboard.writeText('$AXN').then(() => setCopied(true)).catch(() => setCopied(true)); };

  const handleClaim = async () => {
    if (!copied || state === 'checking') return;
    setState('checking');
    try {
      const res = await apiRequest('POST', '/api/axn-name/verify', {});
      const data = await res.json();
      if (data.success) {
        setDone(true);
        showNotification(data.message || '+0.01 GRAM earned!', 'success');
        queryClient.setQueryData(['/api/auth/user'], (old: any) => {
          if (!old) return old;
          return { ...old, balance: String(parseFloat(old.balance || '0') + 0.01), axnNameClaimedToday: true };
        });
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      } else {
        setState('idle');
        showNotification(data.message || '$AXN not found in your Telegram name', 'error');
      }
    } catch (e: any) {
      setState('idle');
      let msg = 'Verification failed';
      try { const p = JSON.parse(e.message); if (p.message) msg = p.message; } catch {}
      showNotification(msg, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ color: TEXT, fontSize: 14, fontWeight: 800 }}>Add $AXN to your name</span>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 5 }}>+0.01 <TonIcon size={15} /></span>
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        {state === 'checking' ? (
          <button disabled style={{ background: 'rgba(255,255,255,0.06)', border: 'none', fontSize: 12, fontWeight: 800, padding: '9px 16px', borderRadius: 10, color: TEXT_DIM, cursor: 'default' }}>Checking…</button>
        ) : copied ? (
          <button onClick={handleClaim} style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)', border: 'none', fontSize: 12, fontWeight: 800, padding: '9px 16px', borderRadius: 10, color: '#fff', cursor: 'pointer', boxShadow: '0 2px 12px rgba(34,197,94,0.35)' }} className="active:scale-95 transition-transform">CLAIM</button>
        ) : (
          <button onClick={handleCopy} style={{ background: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`, border: 'none', fontSize: 12, fontWeight: 800, padding: '9px 16px', borderRadius: 10, color: '#fff', cursor: 'pointer', boxShadow: '0 2px 10px rgba(37,99,235,0.3)' }} className="active:scale-95 transition-transform">COPY</button>
        )}
      </div>
    </div>
  );
}


function PartnerTaskRow({ task }: { task: any }) {
  const [clicked, setClicked] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [done, setDone] = useState(task.completed);
  const queryClient = useQueryClient();

  if (done) return null;

  const handleRowClick = () => {
    if (claiming) return;
    if (!clicked) {
      if (task.url) window.open(task.url, '_blank');
      setClicked(true);
    }
  };

  const handleClaim = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (claiming) return;
    setClaiming(true);
    try {
      const res = await apiRequest('POST', `/api/bounty-tasks/${task.id}/complete`, {});
      const data = await res.json();
      if (data.success !== false) {
        setDone(true);
        showNotification(`+${task.gramReward} GRAM earned!`, 'success');
        queryClient.setQueryData(['/api/auth/user'], (old: any) => {
          if (!old) return old;
          return { ...old, balance: String(parseFloat(old.balance || '0') + Number(task.gramReward || 0)) };
        });
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        queryClient.invalidateQueries({ queryKey: ['/api/bounty-tasks'] });
      } else {
        showNotification(data.message || 'Failed to claim', 'error');
      }
    } catch (e: any) {
      let msg = 'Failed to claim';
      try { const p = JSON.parse(e.message); if (p.message) msg = p.message; } catch {}
      showNotification(msg, 'error');
    }
    setClaiming(false);
  };

  return (
    <div className="task-row" onClick={handleRowClick} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px', cursor: clicked ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent' }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ color: TEXT, fontSize: 14, fontWeight: 800 }}>{task.title}</span>
        </div>
        {task.description && <div style={{ color: TEXT_DIM, fontSize: 12, marginTop: 2 }}>{task.description}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>
        {!clicked ? (
          <span style={{ background: 'rgba(37,99,235,0.15)', borderRadius: 8, color: BLUE, fontSize: 11, fontWeight: 800, padding: '5px 9px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>+{task.gramReward} <TonIcon size={13} /></span>
        ) : (
          <button onClick={handleClaim} disabled={claiming} style={{ background: claiming ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #16a34a, #22c55e)', border: 'none', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 800, color: claiming ? TEXT_DIM : '#fff', cursor: claiming ? 'not-allowed' : 'pointer', boxShadow: claiming ? 'none' : '0 2px 12px rgba(34,197,94,0.35)' }} className="active:scale-95 transition-transform">
            {claiming ? '…' : 'CLAIM'}
          </button>
        )}
      </div>
    </div>
  );
}

function UserTaskRow({ task }: { task: any }) {
  const [clicked, setClicked] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [done, setDone] = useState(!!task.completed_by_me);
  const queryClient = useQueryClient();

  if (done) return null;

  const isChannel = task.category === 'channel_group';

  const handleRowClick = () => {
    if (claiming) return;
    if (!clicked) {
      if (task.link) window.open(task.link, '_blank');
      setClicked(true);
    }
  };

  const handleClaim = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (claiming) return;
    setClaiming(true);
    try {
      const res = await apiRequest('POST', `/api/user-tasks/${task.id}/complete`, {});
      const data = await res.json();
      if (data.success) {
        setDone(true);
        showNotification(`+${task.reward_per_completion} GRAM earned!`, 'success');
        queryClient.setQueryData(['/api/auth/user'], (old: any) => {
          if (!old) return old;
          return { ...old, balance: String(parseFloat(old.balance || '0') + Number(task.reward_per_completion || 0)) };
        });
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        queryClient.invalidateQueries({ queryKey: ['/api/user-tasks'] });
      } else {
        showNotification(data.message || 'Failed to claim', 'error');
      }
    } catch (e: any) {
      let msg = 'Failed to claim';
      try { const p = JSON.parse(e.message); if (p.message) msg = p.message; } catch {}
      showNotification(msg, 'error');
    }
    setClaiming(false);
  };

  return (
    <div className="task-row" onClick={handleRowClick} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px', cursor: clicked ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent' }}>
      {isChannel
        ? <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: TEXT, fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{task.title}</span>
      </div>
      <div style={{ flexShrink: 0 }}>
        {!clicked ? (
          <span style={{ background: 'rgba(168,85,247,0.15)', borderRadius: 8, color: '#a855f7', fontSize: 11, fontWeight: 800, padding: '5px 9px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>+{task.reward_per_completion} <TonIcon size={13} /></span>
        ) : (
          <button onClick={handleClaim} disabled={claiming} style={{ background: claiming ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #16a34a, #22c55e)', border: 'none', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 800, color: claiming ? TEXT_DIM : '#fff', cursor: claiming ? 'not-allowed' : 'pointer', boxShadow: claiming ? 'none' : '0 2px 12px rgba(34,197,94,0.35)' }} className="active:scale-95 transition-transform">
            {claiming ? '…' : 'CLAIM'}
          </button>
        )}
      </div>
    </div>
  );
}

function _RemovedAddMissionPopup({ onClose, userBalance, isAdmin }: { onClose: () => void; userBalance: number; isAdmin: boolean }) {
  const [tab, setTab] = useState<'user' | 'partner'>('user');

  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [category, setCategory] = useState<'channel_group' | 'website_bot'>('channel_group');
  const [impressions, setImpressions] = useState('10');
  const [loading, setLoading] = useState(false);

  const [pTitle, setPTitle] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pUrl, setPUrl] = useState('');
  const [pReward, setPReward] = useState('50');
  const [pImpressions, setPImpressions] = useState('0');
  const [pLoading, setPLoading] = useState(false);

  const queryClient = useQueryClient();

  const imp = Math.max(10, parseInt(impressions, 10) || 10);
  const totalCost = imp * 35;
  const canAfford = userBalance >= totalCost;
  const titlePlaceholder = category === 'channel_group' ? 'Join My Channel' : 'Visit My Website / Bot';

  const inputStyle: Record<string, any> = {
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
    padding: '11px 13px', color: TEXT, fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  const handleCreate = async () => {
    if (!title.trim()) { showNotification('Enter a task name', 'error'); return; }
    if (!link.trim()) { showNotification('Enter a task link', 'error'); return; }
    if (!canAfford) { showNotification(`Insufficient balance. Need ${totalCost} GRAM`, 'error'); return; }
    setLoading(true);
    try {
      const res = await apiRequest('POST', '/api/user-tasks', { title: title.trim(), link: link.trim(), category, impressions: imp });
      const data = await res.json();
      if (data.success) {
        showNotification(data.message || 'Task submitted for review!', 'success');
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        queryClient.invalidateQueries({ queryKey: ['/api/user-tasks'] });
        onClose();
      } else {
        showNotification(data.message || 'Failed to create task', 'error');
      }
    } catch (e: any) {
      let msg = 'Failed to create task';
      try { const p = JSON.parse(e.message); if (p.message) msg = p.message; } catch {}
      showNotification(msg, 'error');
    }
    setLoading(false);
  };

  const handleCreatePartner = async () => {
    if (!pTitle.trim()) { showNotification('Enter a title', 'error'); return; }
    setPLoading(true);
    try {
      const res = await apiRequest('POST', '/api/admin/partner-tasks', { title: pTitle.trim(), description: pDesc.trim(), url: pUrl.trim(), gramReward: parseFloat(pReward), totalImpressions: parseInt(pImpressions, 10) });
      const data = await res.json();
      if (data.success) {
        showNotification('Partner task created!', 'success');
        queryClient.invalidateQueries({ queryKey: ['/api/bounty-tasks'] });
        onClose();
      } else {
        showNotification(data.message || 'Failed', 'error');
      }
    } catch {
      showNotification('Failed to create', 'error');
    }
    setPLoading(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%',
        background: 'linear-gradient(160deg, #0d0d0f, #111118)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '28px 28px 0 0',
        maxHeight: '82vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Top blue light bar */}
        <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, #2563eb, #3b82f6, #2563eb, transparent)', flexShrink: 0 }} />
        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', padding: '20px 20px', paddingBottom: 'max(40px, calc(env(safe-area-inset-bottom, 0px) + 24px))' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', margin: '0 auto 20px' }} />

          {/* Admin tab selector */}
          {isAdmin && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              <button onClick={() => setTab('user')} style={{
                padding: '9px 0', borderRadius: 12,
                border: `1.5px solid ${tab === 'user' ? BLUE : 'rgba(255,255,255,0.1)'}`,
                background: tab === 'user' ? 'rgba(37,99,235,0.15)' : 'rgba(255,255,255,0.04)',
                color: tab === 'user' ? BLUE : TEXT_DIM, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>User Mission</button>
              <button onClick={() => setTab('partner')} style={{
                padding: '9px 0', borderRadius: 12,
                border: `1.5px solid ${tab === 'partner' ? '#a855f7' : 'rgba(255,255,255,0.1)'}`,
                background: tab === 'partner' ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.04)',
                color: tab === 'partner' ? '#a855f7' : TEXT_DIM, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>Partner Task</button>
            </div>
          )}

          {/* ── User Mission Form ── */}
          {tab === 'user' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>Add Mission</div>
                <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 3 }}>Promote your channel or bot.</div>
              </div>

              {/* Category */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {([['channel_group', 'Channel / Group'], ['website_bot', 'Website / Bot']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setCategory(val)} style={{
                    padding: '9px 0', borderRadius: 11,
                    border: `1.5px solid ${category === val ? BLUE : 'rgba(255,255,255,0.1)'}`,
                    background: category === val ? 'rgba(37,99,235,0.15)' : 'rgba(255,255,255,0.04)',
                    color: category === val ? BLUE : TEXT_DIM, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>{label}</button>
                ))}
              </div>

              {/* Task Name — placeholder changes by category */}
              <input
                value={title} onChange={e => setTitle(e.target.value)}
                placeholder={titlePlaceholder}
                style={inputStyle}
              />

              {/* Task Link */}
              <input
                value={link} onChange={e => setLink(e.target.value)}
                placeholder="https://t.me/yourchannel"
                style={inputStyle}
              />

              {/* Impressions — only input, no right grid */}
              <input
                type="number" value={impressions}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  setImpressions(isNaN(v) ? '' : String(v));
                }}
                onBlur={() => {
                  const v = parseInt(impressions, 10);
                  if (isNaN(v) || v < 10) setImpressions('10');
                }}
                min={10} placeholder="10"
                style={inputStyle}
              />

              {/* Cost summary inline — no "Total" label */}
              <div style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(59,130,246,0.12)', borderRadius: 11, padding: '9px 13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: TEXT_DIM, fontSize: 12 }}>{imp} impressions × 0.00035 GRAM</span>
                <span style={{ color: canAfford ? BLUE : '#f87171', fontSize: 13, fontWeight: 900 }}>{totalCost} GRAM</span>
              </div>

              {/* Warning — indigo color */}
              <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 11, padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span style={{ color: 'rgba(199,210,254,0.7)', fontSize: 11, lineHeight: 1.5 }}>
                  Add the verification bot as admin in your channel/group for task verification.
                </span>
              </div>

              <button
                onClick={handleCreate}
                disabled={loading || !canAfford}
                style={{
                  width: '100%', padding: '13px 0',
                  background: loading || !canAfford ? 'rgba(255,255,255,0.06)' : `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`,
                  border: 'none', borderRadius: 13, color: loading || !canAfford ? TEXT_DIM : '#fff',
                  fontSize: 14, fontWeight: 800, cursor: loading || !canAfford ? 'not-allowed' : 'pointer',
                  boxShadow: loading || !canAfford ? 'none' : '0 4px 16px rgba(37,99,235,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
                className={loading || !canAfford ? '' : 'active:scale-95 transition-transform'}
              >
                {loading && <span style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
                {loading ? 'Publishing…' : `Publish · ${totalCost} GRAM`}
              </button>
            </div>
          )}

          {/* ── Admin Partner Task Form ── */}
          {tab === 'partner' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 900, color: TEXT }}>Add Partner Task</div>
                <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 3 }}>Admin-created task visible to all users.</div>
              </div>
              <input value={pTitle} onChange={e => setPTitle(e.target.value)} placeholder="Task title" style={inputStyle} />
              <input value={pDesc} onChange={e => setPDesc(e.target.value)} placeholder="Short description (optional)" style={inputStyle} />
              <input value={pUrl} onChange={e => setPUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input type="number" value={pReward} onChange={e => setPReward(e.target.value)} placeholder="Reward (GRAM)" min={0} step="0.00001" style={inputStyle} />
                <input type="number" value={pImpressions} onChange={e => setPImpressions(e.target.value)} placeholder="Impressions" min={0} style={inputStyle} />
              </div>
              <button
                onClick={handleCreatePartner} disabled={pLoading}
                style={{
                  width: '100%', padding: '13px 0',
                  background: pLoading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #7c3aed, #a855f7)',
                  border: 'none', borderRadius: 13, color: pLoading ? TEXT_DIM : '#fff',
                  fontSize: 14, fontWeight: 800, cursor: pLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
                className={pLoading ? '' : 'active:scale-95 transition-transform'}
              >
                {pLoading && <span style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
                {pLoading ? 'Creating…' : 'Create Partner Task'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ title, subtitle }: { title: string; subtitle?: string }) {
  const firstSpace = title.indexOf(' ');
  const firstWord = firstSpace === -1 ? title : title.slice(0, firstSpace);
  const remainingWords = firstSpace === -1 ? '' : title.slice(firstSpace + 1);

  return (
    <div style={{ marginBottom: 10 }}>
      <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px', lineHeight: 1.2 }}>
        <span style={{ color: BLUE }}>{firstWord}</span>
        {remainingWords && <span style={{ color: TEXT }}>{` ${remainingWords}`}</span>}
      </span>
      {subtitle && <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function MyMissionRow({ task, isLast, onDeleted }: { task: any; isLast: boolean; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const queryClient = useQueryClient();

  const progress = task.completed_count || 0;
  const total = task.impressions || 0;
  const remaining = total - progress;
  const refundAmount = remaining * 35;
  const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;

  const statusColor: Record<string, string> = {
    pending:  '#f59e0b',
    approved: '#22c55e',
    rejected: '#ef4444',
    paused:   '#6b7280',
  };
  const statusLabel: Record<string, string> = {
    pending:  'Pending Review',
    approved: 'Active',
    rejected: 'Rejected',
    paused:   'Paused',
  };
  const color = statusColor[task.status] || '#6b7280';
  const isChannel = task.category === 'channel_group';

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await apiRequest('DELETE', `/api/my-tasks/${task.id}`, {});
      const data = await res.json();
      if (data.success) {
        showNotification(data.message || `Deleted! +${refundAmount} GRAM refunded.`, 'success');
        queryClient.invalidateQueries({ queryKey: ['/api/my-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        onDeleted();
      } else {
        showNotification(data.message || 'Delete failed', 'error');
      }
    } catch {
      showNotification('Delete failed. Try again.', 'error');
    }
    setDeleting(false);
    setShowConfirm(false);
  };

  const canDelete = task.status !== 'rejected';

  return (
    <>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {isChannel
            ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ color: TEXT, fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{task.title}</span>
              <span style={{ background: `${color}22`, borderRadius: 5, color, fontSize: 9, fontWeight: 800, padding: '2px 6px', flexShrink: 0 }}>{statusLabel[task.status] || task.status}</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: task.status === 'approved' ? '#22c55e' : 'rgba(255,255,255,0.2)', borderRadius: 4, transition: 'width 0.4s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                <span style={{ color: TEXT_DIM, fontSize: 10 }}>{progress}/{total} impressions done</span>
                <span style={{ color: TEXT_DIM, fontSize: 10 }}>{pct}%</span>
              </div>
            </div>
          </div>
          {canDelete && (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={deleting}
              style={{ flexShrink: 0, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          )}
        </div>

        {/* Confirm delete panel */}
        {showConfirm && (
          <div style={{ marginTop: 10, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ color: '#fca5a5', fontSize: 11, marginBottom: 8, lineHeight: 1.4 }}>
              Delete this mission?{remaining > 0 ? ` You'll get back ${refundAmount} GRAM (${remaining} unused impressions × 0.00035).` : ' No refund — all impressions used.'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleDelete} disabled={deleting} style={{ flex: 1, padding: '7px 0', background: 'rgba(239,68,68,0.6)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
              <button onClick={() => setShowConfirm(false)} style={{ flex: 1, padding: '7px 0', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: TEXT_DIM, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {!isLast && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />}
    </>
  );
}

function EmptyTaskState({ label }: { label: string }) {
  return (
    <div style={{ padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span style={{ color: 'rgba(255,255,255,0.22)', fontSize: 12 }}>{label}</span>
    </div>
  );
}

export default function Earn() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState<EarnTab>('ads');
  const [, setLocation] = useLocation();

  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], staleTime: 0 });
  const { data: providerStatusData } = useQuery<{ providers: ProviderStatusMap }>({
    queryKey: providerStatusKey,
    staleTime: 0,
    refetchInterval: 30000,
  });
  const { data: bountyTasksRaw } = useQuery<any>({ queryKey: ['/api/bounty-tasks'], staleTime: 30000 });
  const bountyTasks: any[] = Array.isArray(bountyTasksRaw) ? bountyTasksRaw : (bountyTasksRaw?.tasks ?? []);
  const { data: userTasks = [] } = useQuery<any[]>({ queryKey: ['/api/user-tasks'], staleTime: 30000 });

  const axnNameClaimedToday = !!user?.axnNameClaimedToday;

  const partnerTasks = bountyTasks.filter((t: any) => t.isActive !== false && !t.completed);
  const botTasks = (userTasks as any[]).filter((t: any) => t.category === 'website_bot' && !t.completed_by_me);
  const socialTasks = (userTasks as any[]).filter((t: any) => t.category === 'channel_group' && !t.completed_by_me);

  const tabs: { id: EarnTab; label: string }[] = [
    { id: 'ads', label: 'Ads' },
    { id: 'social', label: 'Social' },
    { id: 'partner', label: 'Partner' },
    { id: 'bot', label: 'Bot' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column', overflowX: 'hidden', width: '100%' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .task-row + .task-row { border-top: 1px solid rgba(255,255,255,0.05); }
      `}</style>
      <Header onMenuOpen={() => setMenuOpen(true)} />

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 'max(86px, calc(env(safe-area-inset-bottom, 0px) + 86px))', paddingTop: 'calc(var(--header-height, 62px) + 12px)', width: '100%' }}>

        <div style={{ padding: '0 16px' }}>

            {/* Earn category tabs */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6,
              padding: 4, marginBottom: 18, borderRadius: 14,
              background: 'rgba(255,255,255,0.05)',
            }}>
              {tabs.map(tab => {
                const active = selectedTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSelectedTab(tab.id)}
                    aria-pressed={active}
                    style={{
                      border: 'none', borderRadius: 10, padding: '9px 4px',
                      background: active ? '#2563eb' : 'transparent',
                      color: active ? '#fff' : 'rgba(255,255,255,0.42)',
                      fontSize: 12, fontWeight: 800, cursor: 'pointer',
                      transition: 'background 0.18s ease, color 0.18s ease',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Ads */}
            {selectedTab === 'ads' && (
              <>
                {!axnNameClaimedToday && (
                  <div style={{ background: CARD, borderRadius: 16, overflow: 'hidden', marginBottom: 18 }}>
                    <AxnNameTaskDaily claimedToday={axnNameClaimedToday} />
                  </div>
                )}
                <SectionLabel title="Earn with Ads" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                  {AD_TASKS.map((t, i) => (
                    <AdProviderRow
                      key={t.provider}
                      slotId={t.slotId}
                      provider={t.provider}
                      statusKey={t.statusKey}
                      reward={providerStatusData?.providers?.[t.statusKey]?.reward ?? t.reward}
                      dailyLimit={providerStatusData?.providers?.[t.statusKey]?.dailyLimit ?? t.dailyLimit}
                      status={providerStatusData?.providers?.[t.statusKey]}
                      isLast={i === AD_TASKS.length - 1}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Social */}
            {selectedTab === 'social' && (
              <>
                <SectionLabel title="Social Tasks" />
                <div style={{ background: CARD, borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
                  {socialTasks.length > 0
                    ? socialTasks.map((task: any) => <UserTaskRow key={task.id} task={task} />)
                    : <EmptyTaskState label="No channel/group tasks available right now." />}
                </div>
              </>
            )}

            {/* Partner */}
            {selectedTab === 'partner' && (
              <>
                <SectionLabel title="Partner Tasks" />
                <div style={{ background: CARD, borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
                  {partnerTasks.length > 0
                    ? partnerTasks.map((task: any) => <PartnerTaskRow key={task.id} task={task} />)
                    : <EmptyTaskState label="No partner tasks available right now." />}
                </div>
              </>
            )}

            {/* Bot */}
            {selectedTab === 'bot' && (
              <>
                <SectionLabel title="Bot Tasks" />
                <div style={{ background: CARD, borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
                  {botTasks.length > 0
                    ? botTasks.map((task: any) => <UserTaskRow key={task.id} task={task} />)
                    : <EmptyTaskState label="No bot/website tasks available right now." />}
              </div>
              </>
            )}

        </div>
      </div>

      {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
