import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Zap, ChevronRight, ArrowLeft,
  Activity, FileText, Lock, Info, Shield,
} from "lucide-react";
import { FaBalanceScale, FaCrown } from "react-icons/fa";
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

type Overlay = "legal" | "terms" | "faq" | null;

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

export default function MenuPopup({ onClose, onOpenInvite }: MenuPopupProps) {
  const { isAdmin } = useAdmin();
  const [, setLocation] = useLocation();
  const [overlay, setOverlay] = useState<Overlay>(null);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], retry: false, staleTime: 60000 });

  const firstName: string = user?.firstName || user?.username || "User";
  const profileImageUrl: string | null =
    user?.profileImageUrl ||
    (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url) ||
    null;
  const initials = firstName.slice(0, 2).toUpperCase();
  const joinedAt = user?.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : null;

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Outer border — blue glow + cut corners */}
      <div style={{ clipPath: CUT_LG, padding: '1.5px', background: 'rgba(255,255,255,0.08)', boxShadow: '0 20px 70px rgba(0,0,0,0.55)', width: '100%', maxWidth: 384 }}>
      <motion.div
        className="relative w-full popup-glow-open"
        style={{ clipPath: CUT_LG, background: '#0a0a0a', position: 'relative', overflow: 'hidden' }}
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
                style={{ background: 'rgba(10,10,10,0.98)' }}
              >
                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto min-h-0">

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
                        { q: "How do referral rewards work?", a: "You receive 1,000 CIPHER when a referred friend collects 100 AXN, plus a 5% commission on each referred-friend deposit. Both rewards are credited automatically." },
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
        style={{ clipPath: CUT_SM, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', padding: '10px 14px' }}
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

function LegalBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.06] border border-white/5 rounded-2xl p-4">
      <p className="text-white font-black text-xs mb-2 flex items-center gap-1.5">{icon}{title}</p>
      <div className="text-white/45 text-xs leading-relaxed space-y-1">{children}</div>
    </div>
  );
}
