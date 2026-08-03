import { motion, AnimatePresence } from "framer-motion";
import { RiCalendarFill, RiMapPinFill, RiRocketFill, RiCpuFill, RiGlobalFill, RiStarFill, RiFlashlightFill, RiBarChartFill, RiShieldFill, RiGroupFill, RiMap2Fill } from "react-icons/ri";
import { BsLightningChargeFill } from "react-icons/bs";

const CUT_SM = 'polygon(8px 0%,calc(100% - 8px) 0%,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0% calc(100% - 8px),0% 8px)';
const CUT_LG = 'polygon(14px 0%,calc(100% - 14px) 0%,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0% calc(100% - 14px),0% 14px)';

const TITLE_FONT = "'Oxanium', 'Space Grotesk', sans-serif";
const BODY_FONT = "'Inter', sans-serif";

/* ── Reusable glowing-border wrapper (same technique as START FARMING) ── */
function GlowCard({
  children,
  active = false,
  cut = "lg",
  style = {},
}: {
  children: React.ReactNode;
  active?: boolean;
  cut?: "sm" | "lg";
  style?: React.CSSProperties;
}) {
  const cp = cut === "lg" ? CUT_LG : CUT_SM;
  const borderGrad = active
    ? "linear-gradient(135deg,rgba(0,160,255,0.85) 0%,rgba(0,80,200,0.55) 50%,rgba(0,160,255,0.85) 100%)"
    : "linear-gradient(135deg,rgba(0,100,200,0.45) 0%,rgba(0,50,140,0.25) 50%,rgba(0,100,200,0.45) 100%)";
  const shadow = active
    ? "0 0 22px rgba(0,120,255,0.35)"
    : "0 0 10px rgba(0,80,200,0.15)";
  return (
    <div style={{ clipPath: cp, padding: "1.5px", background: borderGrad, boxShadow: shadow, ...style }}>
      <div style={{
        clipPath: cp,
        background: active
          ? "linear-gradient(160deg,rgba(5,18,50,0.98) 0%,rgba(3,10,30,0.98) 100%)"
          : "linear-gradient(160deg,rgba(4,12,36,0.97) 0%,rgba(2,7,22,0.97) 100%)",
        padding: "13px 13px",
      }}>
        {children}
      </div>
    </div>
  );
}

interface RoadmapPopupProps {
  onClose: () => void;
}

const SEASONS = [
  {
    num: 1,
    title: "MINING ERA",
    date: "MAY 2026",
    status: "active" as const,
    tagline: "The beginning of AXIONET.",
    desc: "This phase focused on launching the platform, building the first community, and starting the mining ecosystem.",
    Icon: RiCpuFill,
    items: [
      "AXIONET App Launch",
      "Mining System Activated",
      "Upgrade & Repair Features",
      "Antivirus System",
      "Energy Mechanics",
      "Farming Features",
      "Referral System",
      "Early User Expansion",
      "Community Foundation Built",
    ],
    objective: "Create the foundation of the AXIONET ecosystem and attract the first generation of users.",
  },
  {
    num: 2,
    title: "SYSTEM EVOLUTION",
    date: "JUNE — JULY 2026",
    status: "upcoming" as const,
    tagline: "The ecosystem evolves.",
    desc: "Season 2 marks the end of traditional mining mechanics and the beginning of a smarter activity-based system.",
    Icon: RiFlashlightFill,
    items: [
      "Mining System Removed",
      "Users keep all Season 1 balances",
      "New Task-Based Reward System",
      "Earn AXN through activities & missions",
      "Computer switched to automatic mode",
      "Upgrade / Repair / Antivirus retired",
      "Reduced grinding mechanics",
      "Faster & smoother farming experience",
      "Global Default Level System",
      "Better Battery & Performance Systems",
      "Improved UI / UX Experience",
      "Community Challenges & Events",
    ],
    objective: "Turn AXIONET into a more active, engaging, and scalable ecosystem.",
  },
  {
    num: 3,
    title: "COMPETITIVE ERA",
    date: "AUG — SEP 2026",
    status: "upcoming" as const,
    tagline: "The ecosystem becomes competitive.",
    desc: "This phase focuses on user activity, reputation, rankings, staking, and large-scale reward systems.",
    Icon: RiBarChartFill,
    items: [
      "Reputation System",
      "Rank Progression System",
      "Staking System Added",
      "Stake AXN for future benefits",
      "Missions & Challenges",
      "Community Events",
      "Seasonal Reward Campaigns",
      "Activity-Based Reward System",
      "Competitive User Ecosystem",
      "Higher rewards for active users",
      "Limited-Time Special Events",
      "Bigger ecosystem engagement mechanics",
    ],
    objective: "Build a competitive and highly active digital ecosystem.",
    quote: "«In AXIONET, activity becomes value.»",
  },
  {
    num: 4,
    title: "AXN EXPANSION",
    date: "OCT — DEC 2026",
    status: "upcoming" as const,
    tagline: "AXIONET enters expansion mode.",
    desc: "This phase focuses on scaling the ecosystem toward Web3 infrastructure and larger ecosystem growth.",
    Icon: RiGlobalFill,
    items: [
      "AXN Token Development",
      "Blockchain Integration",
      "Web3 Expansion",
      "Ecosystem Partnerships",
      "Global Community Expansion",
      "Advanced Reward Systems",
      "Large Scale Campaigns",
      "Stronger Ecosystem Infrastructure",
      "Long-Term Platform Scaling",
    ],
    objective: "Expand AXIONET into a scalable Web3 ecosystem.",
  },
];

const VISION_ITEMS = [
  { Icon: RiStarFill,    label: "Activity-Based Rewards" },
  { Icon: RiShieldFill,  label: "Reputation Systems" },
  { Icon: RiBarChartFill,label: "Competitive Participation" },
  { Icon: BsLightningChargeFill, label: "Staking Mechanics" },
  { Icon: RiGroupFill,   label: "Large Community Events" },
  { Icon: RiGlobalFill,  label: "Web3 Infrastructure" },
  { Icon: RiRocketFill,  label: "Global Ecosystem Expansion" },
];

function StatusBadge({ status }: { status: "active" | "upcoming" | "done" }) {
  if (status === "active") return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.45)",
      borderRadius: 20, padding: "3px 10px", flexShrink: 0,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: "#3b82f6",
        boxShadow: "0 0 6px #3b82f6", flexShrink: 0,
        animation: "pulse 1.5s ease-in-out infinite",
      }} />
      <span style={{ color: "#60a5fa", fontSize: 9, fontWeight: 700, letterSpacing: 1, fontFamily: TITLE_FONT }}>ACTIVE NOW</span>
    </div>
  );
  if (status === "done") return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
      borderRadius: 20, padding: "3px 10px", flexShrink: 0,
    }}>
      <span style={{ color: "#34d399", fontSize: 9, fontWeight: 700, fontFamily: TITLE_FONT }}>COMPLETED</span>
    </div>
  );
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 20, padding: "3px 10px", flexShrink: 0,
    }}>
      <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 9, fontWeight: 700, fontFamily: TITLE_FONT, letterSpacing: 0.5 }}>UPCOMING</span>
    </div>
  );
}

export default function RoadmapPopup({ onClose }: RoadmapPopupProps) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[400] flex flex-col"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ background: "linear-gradient(180deg,#020810 0%,#030b1a 100%)" }}
        onClick={onClose}
      >
        <motion.div
          className="relative w-full h-full flex flex-col"
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
          transition={{ type: "spring", damping: 30, stiffness: 280 }}
          onClick={e => e.stopPropagation()}
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          {/* Top accent line */}
          <div style={{ height: 2, background: "linear-gradient(90deg,transparent,#1d4ed8,#3b82f6,#60a5fa,#3b82f6,#1d4ed8,transparent)", flexShrink: 0 }} />

          {/* ── HEADER ── */}
          <div style={{
            paddingTop: 14, paddingLeft: 16, paddingRight: 16, paddingBottom: 12,
            borderBottom: "1px solid rgba(59,130,246,0.15)",
            background: "linear-gradient(180deg,rgba(3,10,32,0.98) 0%,rgba(2,8,22,0.92) 100%)",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <RiMap2Fill style={{ width: 24, height: 24, color: "#3b82f6", filter: "drop-shadow(0 0 6px rgba(59,130,246,0.7))", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <p style={{ color: "#fff", fontWeight: 800, fontSize: 17, margin: 0, letterSpacing: 2, fontFamily: TITLE_FONT, lineHeight: 1 }}>AXIONET</p>
                  <span style={{ color: "#93c5fd", fontSize: 9, fontWeight: 700, background: "rgba(59,130,246,0.13)", border: "1px solid rgba(59,130,246,0.3)", padding: "2px 8px", borderRadius: 20, fontFamily: TITLE_FONT, letterSpacing: 1 }}>ROADMAP 2026</span>
                </div>
                <p style={{ color: "rgba(148,163,184,0.6)", fontSize: 11, margin: "3px 0 0", fontFamily: BODY_FONT, fontStyle: "italic" }}>4 Seasons · Evolution Plan</p>
              </div>
            </div>
            <div style={{ marginTop: 10, clipPath: CUT_SM, padding: "1px", background: "linear-gradient(135deg,rgba(0,100,200,0.5),rgba(0,60,160,0.3),rgba(0,100,200,0.5))" }}>
              <div style={{ clipPath: CUT_SM, background: "rgba(4,14,40,0.9)", padding: "7px 12px", textAlign: "center" }}>
                <p style={{ color: "rgba(147,197,253,0.75)", fontSize: 11, margin: 0, fontFamily: BODY_FONT, fontStyle: "italic", lineHeight: 1.5 }}>«From Mining → To a Complete Digital Ecosystem»</p>
              </div>
            </div>
          </div>

          {/* ── SCROLLABLE BODY ── */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 13px 110px" }}>

            <p style={{ color: "rgba(148,163,184,0.55)", fontSize: 11, margin: "0 0 16px", lineHeight: 1.8, textAlign: "center", fontFamily: BODY_FONT }}>
              AXIONET is evolving step by step. Every season changes the ecosystem and pushes the project toward a larger vision.
            </p>

            {/* Season Cards */}
            {SEASONS.map((s, idx) => {
              const isActive = s.status === "active";
              return (
                <motion.div
                  key={s.num}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.07 }}
                  style={{ marginBottom: 12 }}
                >
                  <GlowCard active={isActive}>
                    {/* Season header row */}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 9 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* Season icon — no box, just inline icon */}
                        <s.Icon style={{
                          width: 18, height: 18, flexShrink: 0,
                          color: isActive ? "#60a5fa" : "rgba(59,130,246,0.55)",
                          filter: isActive ? "drop-shadow(0 0 5px rgba(59,130,246,0.6))" : "none",
                        }} />
                        <div>
                          <p style={{
                            color: "#e2e8f0", fontWeight: 800, fontSize: 13, margin: 0,
                            letterSpacing: 0.8, fontFamily: TITLE_FONT, lineHeight: 1,
                          }}>
                            S{s.num} · {s.title}
                          </p>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                            <RiCalendarFill style={{ width: 10, height: 10, color: "#3b82f6", flexShrink: 0 }} />
                            <span style={{ color: "#60a5fa", fontSize: 10, fontWeight: 500, fontFamily: BODY_FONT }}>{s.date}</span>
                          </div>
                        </div>
                      </div>
                      <StatusBadge status={s.status} />
                    </div>

                    {/* Divider */}
                    <div style={{ height: 1, background: isActive ? "rgba(59,130,246,0.3)" : "rgba(59,130,246,0.1)", margin: "0 0 9px" }} />

                    {/* Tagline */}
                    <p style={{
                      color: "#e2e8f0", fontWeight: 700, fontSize: 12, margin: "0 0 4px",
                      fontFamily: TITLE_FONT, letterSpacing: 0.2,
                    }}>{s.tagline}</p>

                    {/* Desc */}
                    <p style={{
                      color: "rgba(148,163,184,0.65)", fontSize: 11, margin: "0 0 9px",
                      lineHeight: 1.7, fontFamily: BODY_FONT,
                    }}>{s.desc}</p>

                    {/* Feature list */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
                      {s.items.map((item, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <BsLightningChargeFill style={{
                            width: 9, height: 9, flexShrink: 0,
                            color: isActive ? "#3b82f6" : "rgba(59,130,246,0.4)",
                          }} />
                          <span style={{ color: "rgba(203,213,225,0.72)", fontSize: 11, lineHeight: 1.4, fontFamily: BODY_FONT }}>{item}</span>
                        </div>
                      ))}
                    </div>

                    {/* Objective — inner glow card */}
                    <div style={{ clipPath: CUT_SM, padding: "1px", background: "linear-gradient(135deg,rgba(0,80,180,0.4),rgba(0,40,120,0.2),rgba(0,80,180,0.4))" }}>
                      <div style={{ clipPath: CUT_SM, background: "rgba(3,9,28,0.95)", padding: "8px 10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                          <RiMapPinFill style={{ width: 10, height: 10, color: "#3b82f6", flexShrink: 0 }} />
                          <span style={{ color: "rgba(148,163,184,0.45)", fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: TITLE_FONT }}>MAIN OBJECTIVE</span>
                        </div>
                        <p style={{ color: "#93c5fd", fontSize: 11, fontWeight: 400, margin: 0, lineHeight: 1.6, fontFamily: BODY_FONT }}>{s.objective}</p>
                      </div>
                    </div>

                    {s.quote && (
                      <p style={{ color: "rgba(148,163,184,0.38)", fontSize: 10, margin: "9px 0 0", lineHeight: 1.6, fontStyle: "italic", fontFamily: BODY_FONT }}>
                        {s.quote}
                      </p>
                    )}
                  </GlowCard>
                </motion.div>
              );
            })}

            {/* ── Long Term Vision ── */}
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }} style={{ marginBottom: 12 }}>
              <GlowCard active={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <RiRocketFill style={{ width: 18, height: 18, color: "#60a5fa", filter: "drop-shadow(0 0 5px rgba(59,130,246,0.5))", flexShrink: 0 }} />
                  <p style={{
                    color: "#93c5fd", fontWeight: 800, fontSize: 13, margin: 0,
                    letterSpacing: 1.5, textTransform: "uppercase", fontFamily: TITLE_FONT,
                  }}>LONG TERM VISION</p>
                </div>

                <div style={{ height: 1, background: "rgba(59,130,246,0.2)", margin: "0 0 9px" }} />

                <p style={{ color: "rgba(148,163,184,0.6)", fontSize: 11, margin: "0 0 10px", lineHeight: 1.7, fontFamily: BODY_FONT }}>
                  AXIONET started as a mining concept. But the vision is much bigger. The ecosystem is evolving toward:
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {VISION_ITEMS.map((v, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <v.Icon style={{ width: 13, height: 13, color: "#3b82f6", flexShrink: 0 }} />
                      <span style={{ color: "rgba(203,213,225,0.75)", fontSize: 11, fontFamily: BODY_FONT }}>{v.label}</span>
                    </div>
                  ))}
                </div>
              </GlowCard>
            </motion.div>

            {/* ── Final quote ── */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              <GlowCard active={false} cut="lg">
                <div style={{ textAlign: "center", padding: "4px 0" }}>
                  <p style={{
                    color: "rgba(148,163,184,0.5)", fontSize: 12, margin: "0 0 10px",
                    lineHeight: 1.9, fontStyle: "italic", fontFamily: BODY_FONT,
                  }}>
                    «The first users are not just users.<br />
                    They are the first generation of the AXIONET ecosystem.»
                  </p>
                  <div style={{ height: 1, background: "rgba(59,130,246,0.15)", margin: "10px 0" }} />
                  <p style={{
                    color: "#60a5fa", fontWeight: 700, fontSize: 12, margin: 0,
                    letterSpacing: 1, fontFamily: TITLE_FONT,
                  }}>
                    THE EVOLUTION HAS ALREADY STARTED.
                  </p>
                </div>
              </GlowCard>
            </motion.div>

          </div>

          {/* Bottom fade */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 90, pointerEvents: "none",
            background: "linear-gradient(to top, rgba(2,8,16,0.95) 0%, transparent 100%)",
          }} />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
