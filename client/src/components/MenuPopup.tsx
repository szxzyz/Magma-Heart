import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Wifi, CalendarDays, Receipt, Zap, ChevronRight, ArrowLeft,
  TrendingUp, Activity, RefreshCw, Star, FileText, Lock, Info, Shield,
  Loader2, Clock, CheckCircle, XCircle,
} from "lucide-react";
import { RiBarChartFill } from "react-icons/ri";
import { AXNIcon } from "@/components/AXNIcon";
import { FaReceipt, FaBalanceScale, FaCrown } from "react-icons/fa";
import { MdOutlineSupportAgent } from "react-icons/md";
import { BsQuestionCircleFill } from "react-icons/bs";
import { format } from "date-fns";
import { useAdmin } from "@/hooks/useAdmin";
import { useLocation } from "wouter";
import { showNotification } from "@/components/AppNotification";

interface MenuPopupProps {
  onClose: () => void;
  onOpenInvite?: () => void;
}

type Overlay = "transactions" | "stats" | "legal" | "terms" | "faq" | null;

const CUT_SM = 'polygon(8px 0%,calc(100% - 8px) 0%,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0% calc(100% - 8px),0% 8px)';
const CUT_LG = 'polygon(14px 0%,calc(100% - 14px) 0%,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0% calc(100% - 14px),0% 14px)';

const CORNER_ACCENTS = [
  { top:'2px',    left:'14px',  width:'30px', height:'1.5px' },
  { top:'14px',   left:'2px',   width:'1.5px',height:'30px'  },
  { top:'2px',    right:'14px', width:'30px', height:'1.5px' },
  { top:'14px',   right:'2px',  width:'1.5px',height:'30px'  },
  { bottom:'2px', left:'14px',  width:'30px', height:'1.5px' },
  { bottom:'14px',left:'2px',   width:'1.5px',height:'30px'  },
  { bottom:'2px', right:'14px', width:'30px', height:'1.5px' },
  { bottom:'14px',right:'2px',  width:'1.5px',height:'30px'  },
] as React.CSSProperties[];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}
function fmtAge(days: number): string {
  if (days >= 30) return `${Math.floor(days / 30)}mo ${days % 30}d`;
  return `${days}d`;
}

export default function MenuPopup({ onClose, onOpenInvite }: MenuPopupProps) {
  const { isAdmin } = useAdmin();
  const [, setLocation] = useLocation();
  const [overlay, setOverlay] = useState<Overlay>(null);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false, staleTime: 60000 });
  const { data: txData, isLoading: txLoading } = useQuery<any>({
    queryKey: ["/api/withdrawals"], enabled: overlay === "transactions", retry: false,
  });
  const { data: projectStats } = useQuery<any>({
    queryKey: ["/api/project/stats"], enabled: overlay === "stats", retry: false, staleTime: 30000,
  });

  const withdrawals = txData?.withdrawals || [];
  const firstName: string = user?.firstName || user?.username || "User";
  const profileImageUrl: string | null =
    user?.profileImageUrl ||
    (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url) ||
    null;
  const initials = firstName.slice(0, 2).toUpperCase();
  const joinedAt = user?.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : null;

  const getStatusIcon = (status: string) => {
    const s = status?.toLowerCase();
    if (s?.includes("approved") || s?.includes("success") || s?.includes("paid")) return <CheckCircle className="w-4 h-4 text-green-400" />;
    if (s?.includes("reject") || s?.includes("failed")) return <XCircle className="w-4 h-4 text-red-400" />;
    return <Clock className="w-4 h-4 text-yellow-400" />;
  };
  const getStatusColor = (status: string) => {
    const s = status?.toLowerCase();
    if (s?.includes("approved") || s?.includes("success") || s?.includes("paid")) return "text-green-400";
    if (s?.includes("reject") || s?.includes("failed")) return "text-red-400";
    return "text-yellow-400";
  };

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Outer border — blue glow + cut corners */}
      <div style={{ clipPath: CUT_LG, padding: '1.5px', background: 'linear-gradient(135deg,rgba(0,160,255,0.75) 0%,rgba(0,80,200,0.45) 50%,rgba(0,160,255,0.75) 100%)', boxShadow: '0 0 32px rgba(0,120,255,0.45), 0 0 64px rgba(0,80,200,0.2)', width: '100%', maxWidth: 384 }}>
      <motion.div
        className="relative w-full popup-glow-open"
        style={{ clipPath: CUT_LG, background: 'linear-gradient(180deg,rgba(5,16,44,0.99) 0%,rgba(3,9,26,0.99) 100%)', position: 'relative', overflow: 'hidden' }}
        initial={{ scale: 0.88, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.88, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 26, stiffness: 320 }}
      >
        {/* Corner accent lines */}
        {CORNER_ACCENTS.map((s, i) => (
          <div key={i} className="absolute pointer-events-none" style={{ ...s, background: 'rgba(0,200,255,0.75)', zIndex: 10 }} />
        ))}
        {/*
          KEY TRICK:
          - Main menu is rendered normally (relative) → it sets the card's natural height
          - Sub-views are absolute inset-0 → they overlay in the exact same space
          - Card never resizes, no scroll on main menu
        */}
        <div className="relative">

          {/* ── MAIN MENU (sets card height) ── */}
          <div style={{ visibility: overlay ? "hidden" : "visible" }}>
            {/* Profile */}
            <div className="px-5 py-4 border-b border-white/[0.07]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl overflow-hidden flex items-center justify-center flex-shrink-0 bg-white/[0.07]">
                  {profileImageUrl
                    ? <img src={profileImageUrl} alt={firstName} className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    : <span className="text-white font-black text-lg select-none">{initials}</span>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-black text-sm truncate">{firstName}</p>
                  {user?.username && <p className="text-white/40 text-xs mt-0.5">@{user.username}</p>}
                  {joinedAt && <p className="text-white/25 text-[10px] mt-0.5">Joined {joinedAt}</p>}
                </div>
              </div>
            </div>

            <div className="py-2">
              <MenuItem icon={<RiBarChartFill className="w-5 h-5 text-blue-400" />} label="Project Statistics" onClick={() => setOverlay("stats")} />
              <MenuItem icon={<FaReceipt className="w-5 h-5 text-yellow-400" />} label="Transactions" onClick={() => setOverlay("transactions")} />
              <MenuItem icon={<BsQuestionCircleFill className="w-5 h-5 text-sky-400" />} label="FAQs" onClick={() => setOverlay("faq")} />
              <MenuItem icon={<MdOutlineSupportAgent className="w-5 h-5 text-pink-400" />} label="Support" onClick={() => {
                const tg = (window as any).Telegram?.WebApp;
                if (tg?.openTelegramLink) tg.openTelegramLink("https://t.me/szxzyz");
                else window.open("https://t.me/szxzyz", "_blank");
              }} />
              <MenuItem icon={<FaBalanceScale className="w-5 h-5 text-indigo-400" />} label="Privacy Policy" onClick={() => setOverlay("legal")} />
              <MenuItem icon={<FileText className="w-5 h-5 text-orange-400" />} label="Terms and Conditions" onClick={() => setOverlay("terms")} />
              {isAdmin && (
                <>
                  <div className="mx-4 my-1 border-t border-white/5" />
                  <div className="px-4 py-1">
                    <p className="text-white/20 text-[9px] font-black uppercase tracking-widest">Admin</p>
                  </div>
                  <MenuItem icon={<FaCrown className="w-5 h-5 text-yellow-400" />} label="Admin Panel"
                    onClick={() => { onClose(); setLocation("/admin"); }} />
                </>
              )}
            </div>
          </div>

          {/* ── SUB-VIEWS (absolute overlay, same height as card) ── */}
          <AnimatePresence>
            {overlay !== null && (
              <motion.div
                key={overlay}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="absolute inset-0 flex flex-col"
                style={{ background: 'rgba(8,14,32,0.85)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}
              >
                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto min-h-0">

                  {overlay === "stats" && (
                    <div className="px-4 py-4 space-y-4">
                      {!projectStats ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-white/30 animate-spin" /></div>
                      ) : (
                        <>
                          <StatSection label="Core">
                            <div className="grid grid-cols-2 gap-2">
                              <StatCard icon={<Users className="w-3.5 h-3.5 text-blue-400" />} label="Total Users" value={fmtNum(projectStats.totalUsers)} />
                              <StatCard icon={<Wifi className="w-3.5 h-3.5 text-green-400" />} label="Online Now" value={fmtNum(projectStats.onlineNow)} live />
                              <StatCard icon={<CalendarDays className="w-3.5 h-3.5 text-purple-400" />} label="Project Age" value={fmtAge(projectStats.projectAgeDays)} />
                              <StatCard icon={<TrendingUp className="w-3.5 h-3.5 text-yellow-400" />} label="Total Earned" value={`${fmtNum(projectStats.totalEarnings)} AXN`} axnIcon />
                              <StatCard icon={<Receipt className="w-3.5 h-3.5 text-cyan-400" />} label="Withdrawn" value={`${fmtNum(projectStats.totalWithdrawalsAmount)} AXN`} wide axnIcon />
                            </div>
                          </StatSection>
                          <StatSection label="Activity">
                            <div className="grid grid-cols-2 gap-2">
                              <StatCard icon={<Zap className="w-3.5 h-3.5 text-orange-400" />} label="Today Earned" value={`${fmtNum(projectStats.todayEarnings)} AXN`} wide axnIcon />
                              <StatCard icon={<Activity className="w-3.5 h-3.5 text-blue-300" />} label="Daily Active" value={fmtNum(projectStats.dau)} />
                              <StatCard icon={<Activity className="w-3.5 h-3.5 text-indigo-400" />} label="Weekly Active" value={fmtNum(projectStats.wau)} />
                              <StatCard icon={<Users className="w-3.5 h-3.5 text-teal-400" />} label="Referrals" value={fmtNum(projectStats.totalReferrals)} />
                              <StatCard icon={<RefreshCw className="w-3.5 h-3.5 text-green-400" />} label="Uptime" value={`${projectStats.uptimePct}%`} />
                              <StatCard icon={<Star className="w-3.5 h-3.5 text-yellow-400" />} label="Retention" value={`${projectStats.retentionRate}%`} />
                            </div>
                          </StatSection>
                        </>
                      )}
                    </div>
                  )}

                  {overlay === "transactions" && (
                    <div className="px-4 py-4 space-y-2">
                      {txLoading ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-white/30 animate-spin" /></div>
                      ) : withdrawals.length === 0 ? (
                        <div className="flex flex-col items-center py-10 gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center">
                            <Receipt className="w-4 h-4 text-white/20" strokeWidth={1.5} />
                          </div>
                          <p className="text-white/25 text-xs font-bold uppercase tracking-widest">No transactions yet</p>
                        </div>
                      ) : withdrawals.map((w: any) => (
                        <div key={w.id} className="bg-white/[0.06] border border-white/5 rounded-2xl p-3.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <AXNIcon size={16} />
                            <p className="text-white text-sm font-black tabular-nums">{parseFloat(w.amount || "0").toLocaleString()}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-xs font-black capitalize ${getStatusColor(w.status)}`}>{w.status}</p>
                            <p className="text-white/30 text-[10px] mt-0.5">{w.createdAt ? format(new Date(w.createdAt), "dd MMM · HH:mm") : "—"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {overlay === "legal" && (
                    <div className="px-4 py-4 space-y-2.5">
                      <LegalBlock icon={<Lock className="w-3.5 h-3.5 text-purple-400" />} title="Information We Collect">
                        <p>We collect only what is necessary to operate the platform: your Telegram user ID, display name, and username. No email addresses, phone numbers, or financial details are stored.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Shield className="w-3.5 h-3.5 text-blue-400" />} title="How Your Data Is Used">
                        <p>Your data is used solely to manage your account, track AXN balances, process mining rewards, handle withdrawals, and deliver system notifications. We never sell or share your data with third parties.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Activity className="w-3.5 h-3.5 text-green-400" />} title="Activity Monitoring">
                        <p>We monitor usage patterns to prevent fraud, detect multi-account abuse, and maintain platform integrity. This includes IP address, device identifiers, and session data used exclusively for security purposes.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Info className="w-3.5 h-3.5 text-sky-400" />} title="Data Retention">
                        <p>Account data is retained while your account is active. Upon deletion request, all personal data is removed within 30 days. Transaction history may be retained for audit compliance.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Info className="w-3.5 h-3.5 text-orange-400" />} title="Your Rights">
                        <p>You may request access to, correction of, or deletion of your data at any time through our support channel. We aim to respond within 7 business days.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Info className="w-3.5 h-3.5 text-red-400" />} title="Disclaimer">
                        <p>Axionet is an independent platform and is not affiliated with, endorsed by, or connected to Telegram Messenger Inc. AXN rewards are in-platform tokens and their value is not guaranteed.</p>
                      </LegalBlock>
                    </div>
                  )}

                  {overlay === "terms" && (
                    <div className="px-4 py-4 space-y-2.5">
                      <LegalBlock icon={<FileText className="w-3.5 h-3.5 text-orange-400" />} title="Acceptance of Terms">
                        <p>By accessing or using Axionet, you confirm that you have read, understood, and agree to be bound by these Terms. If you do not agree, please discontinue use immediately. We reserve the right to update these Terms at any time.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Shield className="w-3.5 h-3.5 text-blue-400" />} title="Eligibility & Account Rules">
                        <p>You must be at least 18 years of age to use this platform. Each user is permitted one account only. Operating multiple accounts, using bots or automation, or manipulating referral systems will result in a permanent ban without appeal.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Zap className="w-3.5 h-3.5 text-yellow-400" />} title="Mining & Rewards">
                        <p>AXN is earned through machine mining, daily check-ins, task completion, ad interactions, and referrals. Reward rates, mining speeds, and capacity limits are subject to change. Earned AXN has no guaranteed monetary value.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Lock className="w-3.5 h-3.5 text-green-400" />} title="Withdrawals">
                        <p>Withdrawals require a minimum balance threshold and are subject to admin review. Suspicious activity, incomplete verification, or rule violations may result in withdrawal refusal and balance forfeiture.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Users className="w-3.5 h-3.5 text-indigo-400" />} title="Referral Program">
                        <p>Referral rewards are earned when invited users actively participate on the platform. Self-referrals, fake accounts, or coordinated manipulation are strictly prohibited and will result in disqualification of all referral earnings.</p>
                      </LegalBlock>
                      <LegalBlock icon={<Info className="w-3.5 h-3.5 text-red-400" />} title="Limitation of Liability">
                        <p>Axionet is not liable for lost AXN due to technical outages, rate adjustments, account bans resulting from policy violations, or any indirect damages. Use of the platform is at your own risk.</p>
                      </LegalBlock>
                    </div>
                  )}

                  {overlay === "faq" && (
                    <div className="px-4 py-4 space-y-2">
                      {[
                        { q: "How do I earn AXN?", a: "AXN is earned through machine mining, watching ads, completing channel and partner tasks, daily check-ins, and referring friends. Each activity contributes to your total balance." },
                        { q: "How does the Mining Machine work?", a: "Your machine has three upgradeable components: Mining Level, Capacity Level, and CPU Level (each up to level 25). Start the CPU to begin mining AXN into your capacity buffer, then claim when ready." },
                        { q: "What does the antivirus do?", a: "Antivirus protects your CPU from virus attacks that drain your mining time. Once activated, it runs for its full duration regardless of your mining state. Higher antivirus levels provide longer protection." },
                        { q: "How does the referral Well work?", a: "When a friend you invited withdraws AXN, 10% of their withdrawal amount flows into your Well automatically. You also earn 50 AXN each time a friend upgrades their mining machine. Claim your Well balance anytime." },
                        { q: "What is the referral mining boost?", a: "Each active referral adds +0.1 AXN/h to your base mining speed. Boosts are applied automatically when friends remain in the required channel and removed if they leave." },
                        { q: "How do withdrawals work?", a: "Once you reach the minimum withdrawal threshold, submit a request with your Cwallet ID. Your request is reviewed and approved by the admin team. Approved withdrawals are processed in AXN converted to TON." },
                        { q: "Why is my account banned?", a: "Accounts are banned for violations including multiple account creation, self-referrals, using bots or automation, and exploiting platform bugs. Contact support if you believe your ban was issued in error." },
                        { q: "Can I lose my mined AXN?", a: "Your claimed AXN balance is safe. However, unmined amounts in the buffer can be lost to virus attacks if your antivirus is inactive. Keep antivirus active to protect your mining progress." },
                      ].map((faq, i) => (
                        <div key={i} className="bg-white/[0.06] border border-white/5 rounded-2xl p-3.5">
                          <p className="text-white font-bold text-xs mb-1.5">{faq.q}</p>
                          <p className="text-white/45 text-xs leading-relaxed">{faq.a}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Back button — pinned at bottom */}
                <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: '1px solid rgba(0,120,255,0.18)' }}>
                  <button
                    onClick={() => setOverlay(null)}
                    className="w-full flex items-center justify-center gap-2 text-white/50 text-sm font-black uppercase tracking-wider active:opacity-70 transition-opacity"
                    style={{ clipPath: CUT_SM, height: 40, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
      </div>
    </motion.div>
  );
}

function MenuItem({ icon, label, onClick, right }: { icon: React.ReactNode; label: string; onClick: () => void; right?: React.ReactNode }) {
  return (
    <div style={{ margin: '3px 10px' }}>
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between active:opacity-70 transition-opacity"
        style={{ clipPath: CUT_SM, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(0,120,255,0.18)', padding: '10px 14px' }}
      >
        <div className="flex items-center gap-3">
          {icon}
          <span className="text-white text-sm font-semibold">{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {right}
          <ChevronRight className="w-4 h-4 text-white/20" />
        </div>
      </button>
    </div>
  );
}

function StatSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-white/25 text-[10px] font-black uppercase tracking-widest mb-2">{label}</p>
      {children}
    </div>
  );
}

function StatCard({ icon, label, value, live, wide, axnIcon }: { icon: React.ReactNode; label: string; value: string; live?: boolean; wide?: boolean; axnIcon?: boolean }) {
  return (
    <div className={`bg-white/[0.06] border border-white/5 rounded-2xl p-3 ${wide ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        {live && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
      </div>
      <div className="flex items-center gap-1">
        {axnIcon && <AXNIcon size={12} />}
        <p className="text-white font-black text-sm tabular-nums">{value}</p>
      </div>
      <p className="text-white/30 text-[9px] uppercase tracking-wide mt-1">{label}</p>
    </div>
  );
}

function LegalBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.06] border border-white/5 rounded-2xl p-4">
      <p className="text-white font-black text-xs mb-2 flex items-center gap-1.5">{icon}{title}</p>
      <div className="text-white/45 text-xs leading-relaxed space-y-1">{children}</div>
    </div>
  );
}
