import { useEffect, useRef, useState } from "react";
import { motion, useInView, useScroll, useTransform, useMotionValue, useSpring } from "framer-motion";

const BOT_LINK = "https://t.me/Axionetbot/MyWAdz";
const LINKS = {
  announcements: "https://t.me/LightningSatoshi",
  community: "https://t.me/Axionetchat",
  bot: "https://t.me/Axionetbot/MyWAdz",
};

function useReveal(margin = "-100px") {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: margin as any });
  return { ref, inView };
}

/* ─── ICON SVGs ─── */
function IconMining() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  );
}
function IconUpgrade() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>
    </svg>
  );
}
function IconReferral() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function IconTrade() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  );
}
function IconWallet() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  );
}
function IconAirdrop() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>
    </svg>
  );
}
function IconTelegram() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-2.04 9.61c-.15.67-.54.836-1.094.52l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.26 14.4l-2.95-.924c-.64-.203-.654-.64.136-.948l11.526-4.443c.534-.194 1.002.13.83.947-.002-.002-.002 0 0 0l-.24.216z"/>
    </svg>
  );
}
function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}
function IconArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  );
}
function IconExternal() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  );
}
function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

/* ─── ANIMATED BUTTON ─── */
function PrimaryBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative inline-flex items-center gap-2 px-8 py-3.5 rounded-full font-bold text-sm text-white overflow-hidden"
      style={{ background: "linear-gradient(135deg,#3b82f6 0%,#2563eb 50%,#1d4ed8 100%)" }}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
    >
      <span
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: "linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.15) 50%,transparent 100%)", animation: "shimmer-btn 1.5s linear infinite" }}
      />
      <span className="relative z-10 flex items-center gap-2">
        {children}
        <span className="translate-x-0 group-hover:translate-x-1 transition-transform duration-200">
          <IconArrow />
        </span>
      </span>
      <span
        className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ boxShadow: "0 0 30px rgba(59,130,246,0.6)", pointerEvents: "none" }}
      />
    </motion.a>
  );
}

function GhostBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-full font-bold text-sm text-white/60 hover:text-white transition-colors duration-300"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
      whileHover={{ scale: 1.03, borderColor: "rgba(255,255,255,0.2)" } as any}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
    >
      {children}
    </motion.a>
  );
}

/* ─── ROTATING RING ─── */
function CoinHero() {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 280, height: 280 }}>
      {/* Outer rotating ring */}
      <div
        className="absolute rounded-full border border-blue-500/20"
        style={{ width: 260, height: 260, animation: "spin-ring 12s linear infinite" }}
      >
        {[0, 90, 180, 270].map((deg) => (
          <div
            key={deg}
            className="absolute w-2 h-2 rounded-full bg-blue-500"
            style={{
              top: "50%", left: "50%",
              transform: `rotate(${deg}deg) translateX(128px) translateY(-50%)`,
              boxShadow: "0 0 8px rgba(59,130,246,0.8)",
            }}
          />
        ))}
      </div>
      {/* Middle ring counter-rotating */}
      <div
        className="absolute rounded-full border border-cyan-500/15"
        style={{ width: 210, height: 210, animation: "spin-ring-rev 18s linear infinite" }}
      >
        {[45, 135, 225, 315].map((deg) => (
          <div
            key={deg}
            className="absolute w-1 h-1 rounded-full bg-cyan-400"
            style={{
              top: "50%", left: "50%",
              transform: `rotate(${deg}deg) translateX(104px) translateY(-50%)`,
              boxShadow: "0 0 6px rgba(6,182,212,0.8)",
            }}
          />
        ))}
      </div>
      {/* Glow */}
      <div
        className="absolute rounded-full"
        style={{ width: 160, height: 160, background: "radial-gradient(circle,rgba(59,130,246,0.25),transparent 70%)", animation: "glow-pulse 3s ease-in-out infinite" }}
      />
      {/* Coin */}
      <img
        src="/axn-coin.jpg"
        alt="AXN"
        className="relative z-10 rounded-full object-cover"
        style={{ width: 130, height: 130, boxShadow: "0 0 40px rgba(59,130,246,0.5), 0 0 80px rgba(59,130,246,0.2)" }}
      />
    </div>
  );
}

const features = [
  {
    Icon: IconMining,
    title: "AXN Mining",
    desc: "Mine AXN daily inside the platform. Rewards scale with machine level, activity, and referral network growth.",
    color: "#3b82f6",
    bullets: ["Activity-based reward scaling", "Machine level multiplier", "Ecosystem participation bonus"],
  },
  {
    Icon: IconUpgrade,
    title: "Machine Upgrades",
    desc: "Upgrade your mining machine across 25 levels for increased efficiency, higher AXN rewards, and faster progression.",
    color: "#06b6d4",
    bullets: ["25 upgrade levels", "Increased AXN output", "Faster mining progression"],
  },
  {
    Icon: IconReferral,
    title: "Referral Rewards",
    desc: "Earn 10% cashback in TON from referral withdrawals plus 50 AXN every time a referral upgrades their machine.",
    color: "#8b5cf6",
    bullets: ["10% cashback in TON", "50 AXN per upgrade referral", "Unlimited referral depth"],
  },
  {
    Icon: IconTrade,
    title: "Internal Trading",
    desc: "Trade AXN for TON directly inside the platform before the official token launch. Access real ecosystem value early.",
    color: "#10b981",
    bullets: ["AXN to TON conversion", "Active during mining phase", "Instant internal settlement"],
  },
  {
    Icon: IconWallet,
    title: "TON Wallet",
    desc: "Connect your TON-compatible wallet for withdrawals, blockchain transfers, and future AXN withdrawal support.",
    color: "#f59e0b",
    bullets: ["TON withdrawals live", "Future AXN withdrawals", "Secure wallet connection"],
  },
  {
    Icon: IconAirdrop,
    title: "Snapshot & Airdrop",
    desc: "A user snapshot will be taken before the official launch. Active participants receive free AXN allocations.",
    color: "#ef4444",
    bullets: ["Mining activity tracked", "Referral performance scored", "Free AXN distribution"],
  },
];

const roadmap = [
  {
    phase: "Phase 1",
    title: "Ecosystem Launch",
    date: "Completed",
    done: true,
    items: ["AXIONET platform release", "Mining system activation", "Referral system integration", "Wallet connectivity", "Community launch"],
  },
  {
    phase: "Phase 2",
    title: "Mining Expansion",
    date: "May – June 2026",
    done: true,
    items: ["Daily AXN mining begins", "Machine upgrade system live", "AXN to TON internal trading", "TON withdrawals activated", "User growth campaigns"],
  },
  {
    phase: "Phase 3",
    title: "Snapshot Event",
    date: "July 2026",
    done: false,
    items: ["Active user snapshot taken", "Free AXN allocation prepared", "Ecosystem analysis finalized", "Airdrop qualification confirmed"],
  },
  {
    phase: "Phase 4",
    title: "Token Launch",
    date: "August 2026",
    done: false,
    items: ["Official AXN on TON Blockchain", "Real blockchain withdrawals", "Live market value", "Expanded wallet integration"],
  },
  {
    phase: "Phase 5",
    title: "Ecosystem Expansion",
    date: "Q4 2026+",
    done: false,
    items: ["Premium utilities", "Marketplace integration", "Advanced mining systems", "Community governance", "Exchange expansion"],
  },
];

const tokenomics = [
  { label: "Community & Mining Rewards", pct: 45, color: "#3b82f6" },
  { label: "Airdrop Allocation", pct: 15, color: "#06b6d4" },
  { label: "Liquidity & Ecosystem", pct: 15, color: "#8b5cf6" },
  { label: "Development & Expansion", pct: 15, color: "#10b981" },
  { label: "Team Reserve", pct: 10, color: "#f59e0b" },
];

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 500], [0, -100]);
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);

  useEffect(() => {
    const unsub = scrollY.on("change", (v) => setScrolled(v > 40));
    return unsub;
  }, [scrollY]);

  const about = useReveal();
  const featRef = useReveal();
  const roadRef = useReveal();
  const wpRef = useReveal();
  const tokRef = useReveal();

  return (
    <div className="min-h-screen text-white overflow-x-hidden" style={{ background: "#030712", fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif" }}>
      <style>{`
        @keyframes spin-ring { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes spin-ring-rev { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
        @keyframes glow-pulse { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.1)} }
        @keyframes shimmer-btn { 0%{transform:translateX(-200%)} 100%{transform:translateX(200%)} }
        @keyframes float-y { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-16px)} }
        @keyframes bg-shift {
          0%{background-position:0% 50%}
          50%{background-position:100% 50%}
          100%{background-position:0% 50%}
        }
        .shimmer-text {
          background: linear-gradient(90deg,#60a5fa 0%,#c4b5fd 33%,#22d3ee 66%,#60a5fa 100%);
          background-size:200% auto;
          -webkit-background-clip:text;
          -webkit-text-fill-color:transparent;
          animation:shimmer-btn 6s linear infinite;
        }
        html { scroll-behavior:smooth }
        ::selection { background:rgba(59,130,246,0.3) }
      `}</style>

      {/* ─── NAVBAR ─── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
        style={{
          background: scrolled ? "rgba(3,7,18,0.9)" : "transparent",
          backdropFilter: scrolled ? "blur(24px)" : "none",
          borderBottom: scrolled ? "1px solid rgba(255,255,255,0.05)" : "none",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/axn-coin.jpg" alt="AXN" className="w-7 h-7 rounded-full object-cover" />
            <span className="font-black text-base tracking-tight">AXIONET</span>
          </div>
          <div className="hidden md:flex items-center gap-7">
            {[["About","#about"],["Features","#features"],["Roadmap","#roadmap"],["Whitepaper","#whitepaper"],["Tokenomics","#tokenomics"]].map(([label,href]) => (
              <a key={label} href={href} className="text-white/45 hover:text-white text-sm font-medium transition-colors duration-200">{label}</a>
            ))}
          </div>
          <motion.a
            href={BOT_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2 rounded-full font-bold text-sm text-white"
            style={{ background: "linear-gradient(135deg,#3b82f6,#1d4ed8)" }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            <IconTelegram />
            Open Bot
          </motion.a>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Animated mesh background */}
        <div className="absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              background: "radial-gradient(ellipse 80% 60% at 20% 40%,rgba(59,130,246,0.12) 0%,transparent 60%), radial-gradient(ellipse 60% 50% at 80% 60%,rgba(139,92,246,0.1) 0%,transparent 60%), radial-gradient(ellipse 50% 40% at 50% 90%,rgba(6,182,212,0.08) 0%,transparent 60%)",
            }}
          />
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: "linear-gradient(rgba(59,130,246,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(59,130,246,0.07) 1px,transparent 1px)",
              backgroundSize: "72px 72px",
            }}
          />
        </div>

        <motion.div
          style={{ y: heroY, opacity: heroOpacity }}
          className="relative z-10 max-w-6xl mx-auto px-6 pt-28 pb-20 grid lg:grid-cols-2 gap-16 items-center"
        >
          {/* Left — Text */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold text-blue-300 mb-7"
              style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" style={{ animation: "glow-pulse 2s ease-in-out infinite" }} />
              Built on TON Blockchain
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.07 }}
              className="font-black leading-[1.05] mb-5"
              style={{ fontSize: "clamp(44px,6vw,72px)", letterSpacing: "-0.025em" }}
            >
              Next-Generation<br />
              <span className="shimmer-text">Mining Ecosystem</span><br />
              on TON
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.14 }}
              className="text-white/45 text-base md:text-lg leading-relaxed mb-9 max-w-lg"
            >
              Mine AXN, upgrade your machine, trade internally, and earn through referrals — all inside Telegram with real TON Blockchain utility.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-wrap items-center gap-3 mb-12"
            >
              <PrimaryBtn href={BOT_LINK}>Start Mining Free</PrimaryBtn>
              <GhostBtn href="#whitepaper">Read Whitepaper</GhostBtn>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.27 }}
              className="grid grid-cols-3 gap-4"
            >
              {[
                { v: "1,000,000,000", l: "Total AXN Supply" },
                { v: "Aug 2026", l: "Token Launch" },
                { v: "TON", l: "Blockchain" },
              ].map((s, i) => (
                <div key={i} className="border-l-2 border-blue-600/40 pl-4">
                  <div className="font-black text-white text-lg leading-tight">{s.v}</div>
                  <div className="text-white/35 text-xs mt-0.5">{s.l}</div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right — Coin */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.1, type: "spring", stiffness: 100 }}
            className="flex justify-center"
            style={{ animation: "float-y 6s ease-in-out infinite" }}
          >
            <CoinHero />
          </motion.div>
        </motion.div>

        <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none"
          style={{ background: "linear-gradient(to top,#030712,transparent)" }} />
      </section>

      {/* ─── ABOUT ─── */}
      <section id="about" className="py-28 px-6 relative">
        <div className="absolute right-0 top-1/2 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle,rgba(6,182,212,0.08),transparent 70%)", transform: "translate(30%,-50%)" }} />
        <div className="max-w-6xl mx-auto">
          <div ref={about.ref} className="grid md:grid-cols-2 gap-16 items-start">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={about.inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.6 }}
            >
              <p className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-4">About</p>
              <h2 className="font-black text-4xl md:text-5xl leading-tight mb-6" style={{ letterSpacing: "-0.02em" }}>
                What is <span className="shimmer-text">AXIONET</span>
              </h2>
              <div className="space-y-4 text-white/50 text-base leading-relaxed">
                <p>
                  AXIONET is a next-generation mining ecosystem built for the TON Blockchain. The platform allows users to mine AXN, upgrade mining machines, earn rewards through referrals, and participate in a growing ecosystem designed around utility and long-term expansion.
                </p>
                <p>
                  Unlike traditional mining apps that rely only on future promises, AXIONET introduces real ecosystem functionality during the mining phase — including internal AXN trading and TON withdrawals before the official token launch.
                </p>
                <p>
                  The ecosystem is designed for users who want to participate early in the growth of a blockchain-powered platform.
                </p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={about.inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.12 }}
              className="space-y-3"
            >
              {[
                { label: "Daily AXN Mining", val: "Activity-based rewards", color: "#3b82f6" },
                { label: "Internal AXN to TON Trading", val: "Live during mining phase", color: "#06b6d4" },
                { label: "Referral Cashback", val: "10% in TON per referral", color: "#8b5cf6" },
                { label: "Machine Upgrade Bonus", val: "50 AXN per upgrade", color: "#10b981" },
                { label: "Blockchain Withdrawals", val: "TON live, AXN August 2026", color: "#f59e0b" },
                { label: "Snapshot Airdrop", val: "Free AXN for active users", color: "#ef4444" },
              ].map((row, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={about.inView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.4, delay: 0.15 + i * 0.06 }}
                  className="flex items-center justify-between p-4 rounded-xl transition-all duration-200"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = `${row.color}30`;
                    (e.currentTarget as HTMLElement).style.background = `${row.color}08`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: row.color, boxShadow: `0 0 6px ${row.color}` }} />
                    <span className="text-white text-sm font-medium">{row.label}</span>
                  </div>
                  <span className="text-white/35 text-xs">{row.val}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="features" className="py-28 px-6 relative">
        <div className="absolute left-0 top-1/2 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle,rgba(139,92,246,0.08),transparent 70%)", transform: "translate(-30%,-50%)" }} />
        <div className="max-w-6xl mx-auto" ref={featRef.ref}>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={featRef.inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <p className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-4">Features</p>
            <h2 className="font-black text-4xl md:text-5xl" style={{ letterSpacing: "-0.02em" }}>
              Built for <span className="shimmer-text">Real Utility</span>
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 24 }}
                animate={featRef.inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.06 }}
                className="group p-6 rounded-2xl transition-all duration-300 cursor-default"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = `${f.color}08`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${f.color}25`;
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 0 24px ${f.color}10`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110"
                  style={{ background: `${f.color}15`, color: f.color }}
                >
                  <f.Icon />
                </div>
                <h3 className="font-bold text-white text-base mb-2">{f.title}</h3>
                <p className="text-white/40 text-sm leading-relaxed mb-4">{f.desc}</p>
                <ul className="space-y-1.5">
                  {f.bullets.map((b, j) => (
                    <li key={j} className="flex items-center gap-2 text-xs text-white/30">
                      <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${f.color}20`, color: f.color }}>
                        <IconCheck />
                      </span>
                      {b}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── ROADMAP ─── */}
      <section id="roadmap" className="py-28 px-6">
        <div className="max-w-3xl mx-auto" ref={roadRef.ref}>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={roadRef.inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <p className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-4">Roadmap</p>
            <h2 className="font-black text-4xl md:text-5xl" style={{ letterSpacing: "-0.02em" }}>
              Path to <span className="shimmer-text">Launch</span>
            </h2>
          </motion.div>

          <div className="relative space-y-0">
            {/* Vertical line */}
            <div className="absolute left-[18px] top-0 bottom-0 w-px"
              style={{ background: "linear-gradient(to bottom,transparent,rgba(59,130,246,0.35) 8%,rgba(59,130,246,0.35) 92%,transparent)" }} />

            {roadmap.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={roadRef.inView ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="relative flex gap-8 pb-8 last:pb-0"
              >
                {/* Dot */}
                <div className="flex-shrink-0 relative z-10">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={item.done
                      ? { background: "rgba(59,130,246,0.2)", border: "2px solid #3b82f6", boxShadow: "0 0 12px rgba(59,130,246,0.4)" }
                      : { background: "rgba(255,255,255,0.04)", border: "2px solid rgba(255,255,255,0.15)" }}
                  >
                    {item.done ? (
                      <span className="text-blue-400"><IconCheck /></span>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-white/20" />
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 pb-2">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span
                      className="text-xs font-black uppercase tracking-wide px-2.5 py-1 rounded-full"
                      style={item.done
                        ? { background: "rgba(59,130,246,0.12)", color: "#60a5fa" }
                        : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }}
                    >
                      {item.phase}
                    </span>
                    <span className="text-white/30 text-xs">{item.date}</span>
                  </div>
                  <h3 className="font-black text-white text-xl mb-3">{item.title}</h3>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {item.items.map((it, j) => (
                      <div key={j} className="flex items-center gap-2 text-sm text-white/40">
                        <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: item.done ? "#3b82f6" : "rgba(255,255,255,0.2)" }} />
                        {it}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── WHITEPAPER ─── */}
      <section id="whitepaper" className="py-28 px-6 relative">
        <div className="absolute right-0 top-1/3 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle,rgba(59,130,246,0.07),transparent 70%)", transform: "translateX(40%)" }} />
        <div className="max-w-6xl mx-auto" ref={wpRef.ref}>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={wpRef.inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <p className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-4">Whitepaper</p>
            <h2 className="font-black text-4xl md:text-5xl" style={{ letterSpacing: "-0.02em" }}>
              AXN <span className="shimmer-text">Documentation</span>
            </h2>
          </motion.div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left — token table */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={wpRef.inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5 }}
              className="lg:col-span-1 rounded-2xl overflow-hidden"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div className="p-5 border-b border-white/5">
                <h3 className="font-bold text-white text-sm">Token Information</h3>
              </div>
              <div className="p-5 space-y-0">
                {[
                  { k: "Token Name", v: "AXIONET" },
                  { k: "Symbol", v: "AXN" },
                  { k: "Blockchain", v: "TON Network" },
                  { k: "Total Supply", v: "1,000,000,000" },
                  { k: "Launch Date", v: "August 2026" },
                  { k: "Standard", v: "TON Jetton" },
                ].map((row, i) => (
                  <div key={i} className="flex items-center justify-between py-3 border-b border-white/4 last:border-0">
                    <span className="text-white/35 text-xs">{row.k}</span>
                    <span className="text-white font-semibold text-xs">{row.v}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Right — content blocks */}
            <div className="lg:col-span-2 space-y-4">
              {[
                {
                  title: "Introduction",
                  text: "AXIONET is a blockchain-powered mining ecosystem designed to introduce scalable digital rewards and real utility through the TON Blockchain. The ecosystem combines mining, referral growth, internal trading systems, and blockchain functionality into a single platform.",
                },
                {
                  title: "Vision",
                  text: "The vision of AXIONET is to create a user-focused blockchain ecosystem where users can mine digital assets, participate in ecosystem growth, access blockchain utility, and earn rewards through engagement — bridging simple mining apps and real blockchain ecosystems.",
                },
                {
                  title: "Mining Phase",
                  text: "The mining phase allows users to accumulate AXN before the official blockchain launch. During this period, users can mine AXN daily, internal AXN trading is enabled, TON withdrawals are supported, and referral rewards remain active.",
                },
                {
                  title: "Security",
                  text: "AXIONET is committed to ecosystem transparency and long-term platform development. Use official platform links only. The platform will never request private wallet keys or sensitive wallet credentials.",
                },
              ].map((sec, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 16 }}
                  animate={wpRef.inView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.45, delay: i * 0.07 }}
                  className="p-5 rounded-2xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-1 h-4 rounded-full bg-blue-500" />
                    <h3 className="font-bold text-white text-sm">{sec.title}</h3>
                  </div>
                  <p className="text-white/40 text-sm leading-relaxed">{sec.text}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── TOKENOMICS ─── */}
      <section id="tokenomics" className="py-28 px-6 relative">
        <div className="absolute left-1/2 top-1/2 w-[600px] h-[600px] -translate-x-1/2 -translate-y-1/2 pointer-events-none rounded-full"
          style={{ background: "radial-gradient(circle,rgba(59,130,246,0.05),transparent 70%)" }} />
        <div className="max-w-5xl mx-auto" ref={tokRef.ref}>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={tokRef.inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <p className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-4">Tokenomics</p>
            <h2 className="font-black text-4xl md:text-5xl mb-3" style={{ letterSpacing: "-0.02em" }}>
              Token <span className="shimmer-text">Distribution</span>
            </h2>
            <p className="text-white/35 text-base">Total Supply: <span className="text-white font-bold">1,000,000,000 AXN</span></p>
          </motion.div>

          <div className="grid md:grid-cols-5 gap-10 items-center">
            {/* Donut */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={tokRef.inView ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.7 }}
              className="md:col-span-2 flex justify-center"
            >
              <div className="relative" style={{ width: 240, height: 240 }}>
                <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
                  {(() => {
                    let offset = 0;
                    const C = 2 * Math.PI * 70;
                    return tokenomics.map((t, i) => {
                      const dash = (t.pct / 100) * C;
                      const el = (
                        <circle
                          key={i} cx="100" cy="100" r="70"
                          fill="none" stroke={t.color} strokeWidth="26"
                          strokeDasharray={`${dash} ${C - dash}`}
                          strokeDashoffset={-offset}
                          style={{ filter: `drop-shadow(0 0 5px ${t.color}60)` }}
                        />
                      );
                      offset += dash;
                      return el;
                    });
                  })()}
                  <circle cx="100" cy="100" r="55" fill="#030712" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="font-black text-white text-2xl">1B</div>
                  <div className="text-white/30 text-xs font-medium">AXN</div>
                </div>
              </div>
            </motion.div>

            {/* Bars */}
            <div className="md:col-span-3 space-y-5">
              {tokenomics.map((t, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 24 }}
                  animate={tokRef.inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.5, delay: i * 0.07 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: t.color, boxShadow: `0 0 5px ${t.color}` }} />
                      <span className="text-white/60 text-sm">{t.label}</span>
                    </div>
                    <span className="font-black text-sm" style={{ color: t.color }}>{t.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={tokRef.inView ? { width: `${t.pct}%` } : { width: 0 }}
                      transition={{ duration: 0.9, delay: 0.2 + i * 0.07, ease: "easeOut" }}
                      style={{ background: t.color, boxShadow: `0 0 6px ${t.color}50` }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative rounded-3xl overflow-hidden p-14 md:p-20 text-center"
            style={{ background: "linear-gradient(135deg,rgba(59,130,246,0.12),rgba(139,92,246,0.12))", border: "1px solid rgba(59,130,246,0.2)" }}
          >
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: "radial-gradient(ellipse 60% 60% at 50% 0%,rgba(59,130,246,0.15),transparent)" }} />
            <div className="relative z-10">
              <h2 className="font-black text-4xl md:text-5xl mb-4" style={{ letterSpacing: "-0.02em" }}>
                Start Mining Today
              </h2>
              <p className="text-white/40 text-base mb-9 max-w-md mx-auto">
                Free to join. No hardware required. Be an early participant in the AXIONET ecosystem before the official token launch.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <PrimaryBtn href={BOT_LINK}>Open AXIONET Bot</PrimaryBtn>
                <GhostBtn href={LINKS.community}>Join Community</GhostBtn>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t px-6 py-14" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-10 mb-10">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                <img src="/axn-coin.jpg" alt="AXN" className="w-7 h-7 rounded-full object-cover" />
                <span className="font-black text-base">AXIONET</span>
              </div>
              <p className="text-white/30 text-sm leading-relaxed mb-5">
                Next-generation AXN mining ecosystem on the TON Blockchain. Built for real utility and long-term expansion.
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold text-green-400"
                style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ animation: "glow-pulse 2s ease-in-out infinite" }} />
                Mining Phase Active
              </div>
            </div>

            {/* Links */}
            <div>
              <h4 className="text-white/50 text-xs font-bold uppercase tracking-widest mb-5">Official Links</h4>
              <div className="space-y-3.5">
                <a href={LINKS.announcements} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 text-white/35 hover:text-white text-sm transition-all duration-200 group">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-blue-400 transition-colors"
                    style={{ background: "rgba(59,130,246,0.1)" }}>
                    <IconTelegram />
                  </span>
                  <span className="group-hover:translate-x-0.5 transition-transform">Announcements</span>
                  <IconExternal />
                </a>
                <a href={LINKS.community} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 text-white/35 hover:text-white text-sm transition-all duration-200 group">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-blue-400"
                    style={{ background: "rgba(59,130,246,0.1)" }}>
                    <IconTelegram />
                  </span>
                  <span className="group-hover:translate-x-0.5 transition-transform">Community Chat</span>
                  <IconExternal />
                </a>
                <div className="flex items-center gap-3 text-white/15 text-sm cursor-default select-none">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(255,255,255,0.04)" }}>
                    <IconX />
                  </span>
                  <span>X (Twitter) — Coming Soon</span>
                </div>
                <a href={LINKS.bot} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 text-white/35 hover:text-white text-sm transition-all duration-200 group">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-blue-400"
                    style={{ background: "rgba(59,130,246,0.1)" }}>
                    <IconTelegram />
                  </span>
                  <span className="group-hover:translate-x-0.5 transition-transform">AXIONET Bot</span>
                  <IconExternal />
                </a>
              </div>
            </div>

            {/* Nav */}
            <div>
              <h4 className="text-white/50 text-xs font-bold uppercase tracking-widest mb-5">Platform</h4>
              <div className="space-y-3">
                {[["About","#about"],["Features","#features"],["Roadmap","#roadmap"],["Whitepaper","#whitepaper"],["Tokenomics","#tokenomics"]].map(([label,href]) => (
                  <a key={label} href={href}
                    className="flex items-center gap-2 text-white/30 hover:text-white text-sm transition-all duration-200 group">
                    <span className="group-hover:translate-x-0.5 transition-transform">{label}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-3"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <p className="text-white/15 text-xs">
              2026 AXIONET. All rights reserved.
            </p>
            <p className="text-white/15 text-xs">
              Powered by <span className="text-blue-500 font-bold">TON Blockchain</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
