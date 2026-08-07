import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";

const BLUE = '#3b82f6';
const BLUE_D = '#2563eb';
const TEXT = '#fff';
const TEXT_DIM = 'rgba(255,255,255,0.35)';
const CARD = 'rgba(255,255,255,0.07)';
const COST_PER_IMPRESSION_GRAM = 0.00035;

const inputStyle: Record<string, any> = {
  width: '100%', background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
  padding: '11px 13px', color: TEXT, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};

function MyMissionRow({ task, isLast, onDeleted }: { task: any; isLast: boolean; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const queryClient = useQueryClient();

  const progress = task.completed_count || 0;
  const total = task.impressions || 0;
  const remaining = total - progress;
  const refundAmount = remaining * COST_PER_IMPRESSION_GRAM;
  const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;

  const statusColor: Record<string, string> = {
    pending: '#f59e0b',
    approved: '#22c55e',
    rejected: '#ef4444',
    paused: '#6b7280',
  };
  const statusLabel: Record<string, string> = {
    pending: 'Pending Review',
    approved: 'Active',
    rejected: 'Rejected',
    paused: 'Paused',
  };
  const color = statusColor[task.status] || '#6b7280';
  const isChannel = task.category === 'channel_group';
  const canDelete = task.status !== 'rejected';

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
              <span style={{ color: TEXT, fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{task.title}</span>
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
        {showConfirm && (
          <div style={{ marginTop: 10, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ color: '#fca5a5', fontSize: 11, marginBottom: 8, lineHeight: 1.4 }}>
      Delete this mission?{remaining > 0 ? ` You'll get back ${refundAmount} GRAM (${remaining} unused × 0.00035).` : ' No refund — all impressions used.'}
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

function AddMissionForm({ userBalance }: { userBalance: number }) {
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [category, setCategory] = useState<'channel_group' | 'website_bot'>('channel_group');
  const [impressions, setImpressions] = useState('10');
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const imp = Math.max(10, parseInt(impressions, 10) || 10);
  const totalCost = imp * COST_PER_IMPRESSION_GRAM;
  const canAfford = userBalance >= totalCost;
  const titlePlaceholder = category === 'channel_group' ? 'Join My Channel' : 'Visit My Website / Bot';

  const handleCreate = async () => {
    if (!title.trim()) { showNotification('Enter a task name', 'error'); return; }
    if (!link.trim()) { showNotification('Enter a task link', 'error'); return; }
    if (!canAfford) { showNotification(`Insufficient balance. Need ${totalCost} GRAM`, 'error'); return; }
    setLoading(true);
    try {
      const res = await apiRequest('POST', '/api/user-tasks', { title: title.trim(), link: link.trim(), category, impressions: imp });
      const data = await res.json();
      if (data.success) {
        showNotification(data.message || 'Mission submitted for review!', 'success');
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        queryClient.invalidateQueries({ queryKey: ['/api/user-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['/api/my-tasks'] });
        setTitle(''); setLink(''); setImpressions('10');
      } else {
        showNotification(data.message || 'Failed to create mission', 'error');
      }
    } catch (e: any) {
      let msg = 'Failed to create mission';
      try { const p = JSON.parse(e.message); if (p.message) msg = p.message; } catch {}
      showNotification(msg, 'error');
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 900, color: TEXT }}>Promote Your Channel or Bot</div>
        <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 3 }}>Pay GRAM to show your task to all users.</div>
      </div>

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

      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={titlePlaceholder} style={inputStyle} />
      <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://t.me/yourchannel" style={inputStyle} />

      <input
        type="number" value={impressions}
        onChange={e => { const v = parseInt(e.target.value, 10); setImpressions(isNaN(v) ? '' : String(v)); }}
        onBlur={() => { const v = parseInt(impressions, 10); if (isNaN(v) || v < 10) setImpressions('10'); }}
        min={10} placeholder="Impressions (min 10)"
        style={inputStyle}
      />

      <div style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(59,130,246,0.12)', borderRadius: 11, padding: '9px 13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: TEXT_DIM, fontSize: 12 }}>{imp} impressions × 0.00035 GRAM</span>
        <span style={{ color: canAfford ? BLUE : '#f87171', fontSize: 13, fontWeight: 900 }}>{totalCost} GRAM</span>
      </div>

      <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 11, padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span style={{ color: 'rgba(199,210,254,0.7)', fontSize: 11, lineHeight: 1.5 }}>
          Add the verification bot as admin in your channel/group for task verification.
        </span>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 11, padding: '9px 13px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: TEXT_DIM }}>Your balance</span>
          <span style={{ color: canAfford ? TEXT : '#f87171', fontWeight: 800 }}>{userBalance} GRAM</span>
        </div>
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
  );
}

function AdminPartnerTaskForm() {
  const [pTitle, setPTitle] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pUrl, setPUrl] = useState('');
  const [pReward, setPReward] = useState('50');
  const [pImpressions, setPImpressions] = useState('0');
  const [pLoading, setPLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleCreatePartner = async () => {
    if (!pTitle.trim()) { showNotification('Enter a title', 'error'); return; }
    if (!parseInt(pReward, 10)) { showNotification('Enter a reward amount', 'error'); return; }
    setPLoading(true);
    try {
      const res = await apiRequest('POST', '/api/admin/partner-tasks', {
        title: pTitle.trim(),
        description: pDesc.trim(),
        url: pUrl.trim(),
        gramReward: parseFloat(pReward),
        totalImpressions: parseInt(pImpressions, 10),
      });
      const data = await res.json();
      if (data.success) {
        showNotification('Partner task created!', 'success');
        queryClient.invalidateQueries({ queryKey: ['/api/bounty-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['/api/admin/partner-tasks'] });
        setPTitle(''); setPDesc(''); setPUrl(''); setPReward('50'); setPImpressions('0');
      } else {
        showNotification(data.message || 'Failed', 'error');
      }
    } catch {
      showNotification('Failed to create', 'error');
    }
    setPLoading(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 900, color: TEXT }}>Create Partner Task</div>
        <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 3 }}>Admin-created task visible to all users.</div>
      </div>
      <input value={pTitle} onChange={e => setPTitle(e.target.value)} placeholder="Task title" style={inputStyle} />
      <input value={pDesc} onChange={e => setPDesc(e.target.value)} placeholder="Short description (optional)" style={inputStyle} />
      <input value={pUrl} onChange={e => setPUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <input type="number" value={pReward} onChange={e => setPReward(e.target.value)} placeholder="Reward (GRAM)" min={0} step="0.00001" style={inputStyle} />
        <input type="number" value={pImpressions} onChange={e => setPImpressions(e.target.value)} placeholder="Max Impressions" min={0} style={inputStyle} />
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
  );
}

export default function AddMission() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<'add' | 'my' | 'partner'>('add');
  const queryClient = useQueryClient();

  const { data: user } = useQuery<any>({ queryKey: ['/api/auth/user'], staleTime: 0 });
  const { data: myTasks = [] } = useQuery<any[]>({ queryKey: ['/api/my-tasks'], staleTime: 15000 });

  const userBalance = Math.floor(parseFloat(user?.balance || '0'));
  const isAdmin = !!user?.isAdmin;

  const tabs = [
    { id: 'add' as const, label: 'Add Mission' },
    { id: 'my' as const, label: `My Missions${(myTasks as any[]).length > 0 ? ` (${(myTasks as any[]).length})` : ''}` },
    ...(isAdmin ? [{ id: 'partner' as const, label: 'Partner Task' }] : []),
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => setLocation('/earn')} style={{
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, padding: '8px 10px', cursor: 'pointer', color: TEXT,
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: TEXT }}>Missions</div>
          <div style={{ fontSize: 11, color: TEXT_DIM }}>Promote your channel or bot</div>
        </div>
        <div style={{ background: 'rgba(37,99,235,0.12)', borderRadius: 8, padding: '5px 10px' }}>
          <span style={{ color: BLUE, fontSize: 12, fontWeight: 800 }}>{userBalance} GRAM</span>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 16px' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 700,
              color: activeTab === tab.id ? BLUE : TEXT_DIM,
              borderBottom: `2px solid ${activeTab === tab.id ? BLUE : 'transparent'}`,
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', paddingBottom: 40 }}>

        {/* Add Mission Tab */}
        {activeTab === 'add' && <AddMissionForm userBalance={userBalance} />}

        {/* My Missions Tab */}
        {activeTab === 'my' && (
          <div>
            {(myTasks as any[]).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 16px' }}>
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/>
                </svg>
                <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 14, fontWeight: 700 }}>No missions yet</div>
                <div style={{ color: 'rgba(255,255,255,0.15)', fontSize: 12, marginTop: 6 }}>Create your first mission in the Add Mission tab</div>
                <button
                  onClick={() => setActiveTab('add')}
                  style={{ marginTop: 20, padding: '10px 24px', background: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`, border: 'none', borderRadius: 12, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}
                >
                  Add Mission
                </button>
              </div>
            ) : (
              <div style={{ background: CARD, borderRadius: 14, overflow: 'hidden' }}>
                {(myTasks as any[]).map((task: any, i: number) => (
                  <MyMissionRow
                    key={task.id}
                    task={task}
                    isLast={i === (myTasks as any[]).length - 1}
                    onDeleted={() => queryClient.invalidateQueries({ queryKey: ['/api/my-tasks'] })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin Partner Task Tab */}
        {activeTab === 'partner' && isAdmin && <AdminPartnerTaskForm />}

      </div>
    </div>
  );
}
