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
import { faqItems, privacyPolicySections, termsSections } from "@/content/legalContent";

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
                const supportLink = import.meta.env.VITE_SUPPORT_LINK || "";
                if (tg?.openTelegramLink) tg.openTelegramLink(supportLink);
                else window.open(supportLink, "_blank");
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
                      {privacyPolicySections.map((section, i) => <LegalBlock key={section.title} icon={<Info className="w-3.5 h-3.5 text-sky-400" />} title={section.title}><p>{section.text}</p></LegalBlock>)}
                    </div>
                  )}

                  {overlay === "terms" && (
                    <div className="px-4 py-4 space-y-2.5">
                      {termsSections.map(section => <LegalBlock key={section.title} icon={<FileText className="w-3.5 h-3.5 text-orange-400" />} title={section.title}><p>{section.text}</p></LegalBlock>)}
                    </div>
                  )}

                  {overlay === "faq" && (
                    <div className="px-4 py-4 space-y-2">
                      {faqItems.map((faq, i) => (
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
