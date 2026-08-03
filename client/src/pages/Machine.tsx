import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/Header";
import MenuPopup from "@/components/MenuPopup";
import { MACHINE_TYPES, AXN_PER_GRAM, type MachineType } from "../../../shared/machineTypes";

// ─── Helpers ────────────────────────────────────────────────────────
function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m`;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function fmtAxn(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtGram(n: number): string {
  return n.toFixed(4);
}

// ─── Machine Card (Shop) ────────────────────────────────────────────
function MachineCard({ machine, onBuy }: { machine: MachineType; onBuy: (m: MachineType) => void }) {
  const tierColors: Record<string, { from: string; to: string; glow: string; badge: string }> = {
    starter:  { from: "#1e3a5f", to: "#1e293b", glow: "rgba(59,130,246,0.3)",  badge: "#3b82f6" },
    basic:    { from: "#1e3d2f", to: "#1e293b", glow: "rgba(34,197,94,0.3)",   badge: "#22c55e" },
    advanced: { from: "#3d2e1e", to: "#1e293b", glow: "rgba(249,115,22,0.3)",  badge: "#f97316" },
    pro:      { from: "#3d1e3a", to: "#1e293b", glow: "rgba(168,85,247,0.3)",  badge: "#a855f7" },
    elite:    { from: "#3d2e1e", to: "#1e293b", glow: "rgba(251,191,36,0.35)", badge: "#fbbf24" },
    ultra:    { from: "#1e3a3d", to: "#1e293b", glow: "rgba(6,182,212,0.3)",   badge: "#06b6d4" },
    mega:     { from: "#3d1e2e", to: "#1e293b", glow: "rgba(236,72,153,0.3)",  badge: "#ec4899" },
    titan:    { from: "#2e1e3d", to: "#1e293b", glow: "rgba(239,68,68,0.35)",  badge: "#ef4444" },
  };
  const colors = tierColors[machine.id] || tierColors.starter;

  return (
    <div style={{
      background: `linear-gradient(135deg, ${colors.from}, ${colors.to})`,
      border: `1px solid ${colors.badge}33`,
      borderRadius: 16,
      padding: "16px",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Glow */}
      <div style={{
        position: "absolute", top: -40, right: -40, width: 120, height: 120,
        borderRadius: "50%", background: colors.glow, filter: "blur(30px)", pointerEvents: "none",
      }} />

      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{machine.name}</div>
          <div style={{
            display: "inline-block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            background: colors.badge + "22", color: colors.badge, border: `1px solid ${colors.badge}44`,
            borderRadius: 6, padding: "2px 7px",
          }}>
            {machine.durationDays} DAYS
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.badge }}>{fmtGram(machine.priceGram)} GRAM</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>{fmtAxn(machine.priceAxn)} AXN</div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[
          { label: "Hourly",   value: fmtAxn(machine.hourlyAxn) + " AXN",  sub: fmtGram(machine.hourlyGram) + " GRAM" },
          { label: "Daily",    value: fmtAxn(machine.dailyAxn)  + " AXN",  sub: fmtGram(machine.dailyGram)  + " GRAM" },
          { label: "Total ROI",value: fmtGram(machine.totalRoiGram) + " GRAM", sub: fmtAxn(machine.totalRoiAxn) + " AXN" },
          { label: "Duration", value: machine.durationDays + " Days",      sub: machine.durationHours.toLocaleString() + " hrs" },
        ].map(stat => (
          <div key={stat.label} style={{
            background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "8px 10px",
          }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{stat.value}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", marginTop: 1 }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Buy button */}
      <button
        onClick={() => onBuy(machine)}
        style={{
          width: "100%", height: 40, borderRadius: 10, border: "none",
          background: `linear-gradient(135deg, ${colors.badge}, ${colors.badge}bb)`,
          color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
          letterSpacing: "0.04em",
        }}
        className="active:scale-95 transition-transform"
      >
        Buy for {fmtGram(machine.priceGram)} GRAM
      </button>
    </div>
  );
}

// ─── Active Machine Card ─────────────────────────────────────────────
function ActiveMachineCard({ machine }: { machine: any }) {
  const [remaining, setRemaining] = useState(0);
  const [unclaimed, setUnclaimed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mType = MACHINE_TYPES.find(m => m.id === machine.machineType);

  useEffect(() => {
    if (!mType) return;
    const expiresAt = new Date(machine.expiresAt).getTime();
    const lastClaimed = new Date(machine.lastClaimedAt || machine.purchasedAt).getTime();

    function tick() {
      const now = Date.now();
      const rem = Math.max(0, expiresAt - now);
      setRemaining(rem);

      const effectiveNow = Math.min(now, expiresAt);
      const elapsedHours = Math.max(0, effectiveNow - lastClaimed) / (1000 * 60 * 60);
      setUnclaimed(Math.floor(elapsedHours * mType!.hourlyAxn));
    }

    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [machine, mType]);

  if (!mType) return null;

  const expiresAt = new Date(machine.expiresAt).getTime();
  const purchasedAt = new Date(machine.purchasedAt).getTime();
  const totalDurationMs = mType.durationHours * 60 * 60 * 1000;
  const progress = Math.max(0, Math.min(1, (expiresAt - Date.now()) / totalDurationMs));
  const isExpired = Date.now() >= expiresAt;

  const tierBadge: Record<string, string> = {
    starter: "#3b82f6", basic: "#22c55e", advanced: "#f97316", pro: "#a855f7",
    elite: "#fbbf24", ultra: "#06b6d4", mega: "#ec4899", titan: "#ef4444",
  };
  const accent = tierBadge[machine.machineType] || "#3b82f6";

  return (
    <div style={{
      background: "linear-gradient(135deg, #111827, #0f172a)",
      border: `1px solid ${isExpired ? "#374151" : accent + "44"}`,
      borderRadius: 14, padding: "14px 16px",
      opacity: isExpired ? 0.6 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{mType.name}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
            {isExpired ? "Expired" : `${fmtAxn(mType.hourlyAxn)} AXN/hr`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: isExpired ? "#6b7280" : "#10b981" }}>
            {fmtAxn(unclaimed)} AXN
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>unclaimed</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ height: 4, background: "#1f2937", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${(1 - progress) * 100}%`,
            background: isExpired ? "#374151" : `linear-gradient(90deg, ${accent}, ${accent}99)`,
            borderRadius: 2, transition: "width 1s linear",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>
            Earned: {fmtAxn(parseFloat(machine.totalClaimedAxn || "0"))} AXN
          </div>
          <div style={{ fontSize: 9, color: isExpired ? "#6b7280" : "rgba(255,255,255,0.45)", fontWeight: 600 }}>
            {fmtCountdown(remaining)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Popup ───────────────────────────────────────────────────
function ConfirmPopup({ machine, gramBalance, onConfirm, onCancel, loading }: {
  machine: MachineType;
  gramBalance: number;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const canAfford = gramBalance * AXN_PER_GRAM >= machine.priceAxn;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        background: "#111827", borderRadius: "20px 20px 0 0",
        border: "1px solid rgba(255,255,255,0.1)",
        width: "100%", maxWidth: 480, padding: "24px 20px 32px",
      }}>
        <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 2, margin: "0 auto 20px" }} />

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Confirm Purchase</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>You are about to buy:</div>
        </div>

        <div style={{
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12, padding: 16, marginBottom: 16,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 12 }}>{machine.name}</div>
          {[
            { label: "Price",       value: `${fmtGram(machine.priceGram)} GRAM (${fmtAxn(machine.priceAxn)} AXN)` },
            { label: "Duration",    value: `${machine.durationDays} days` },
            { label: "Hourly",      value: `${fmtAxn(machine.hourlyAxn)} AXN/hr` },
            { label: "Daily",       value: `${fmtAxn(machine.dailyAxn)} AXN/day` },
            { label: "Total ROI",   value: `${fmtAxn(machine.totalRoiAxn)} AXN` },
          ].map(row => (
            <div key={row.label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              paddingBottom: 6, marginBottom: 6,
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{row.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{row.value}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Your GRAM Balance</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: canAfford ? "#10b981" : "#ef4444" }}>
              {fmtGram(gramBalance)} GRAM
            </span>
          </div>
        </div>

        {!canAfford && (
          <div style={{
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8, padding: "10px 12px", marginBottom: 14,
            fontSize: 12, color: "#fca5a5", textAlign: "center",
          }}>
            Insufficient AXN balance. Need {fmtAxn(machine.priceAxn)} AXN more to buy this machine.
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, height: 46, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)",
              background: "transparent", color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canAfford || loading}
            style={{
              flex: 2, height: 46, borderRadius: 12, border: "none",
              background: canAfford ? "linear-gradient(135deg, #1d4ed8, #3b82f6)" : "#374151",
              color: canAfford ? "#fff" : "#6b7280", fontSize: 14, fontWeight: 700, cursor: canAfford ? "pointer" : "not-allowed",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Buying..." : "Confirm Purchase"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────
type Tab = "shop" | "my";

export default function MachinePage() {
  const [tab, setTab] = useState<Tab>("shop");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmMachine, setConfirmMachine] = useState<MachineType | null>(null);
  const queryClient = useQueryClient();

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], staleTime: 0 });
  const { data: machineData, refetch: refetchMachines } = useQuery<any>({
    queryKey: ["/api/machines"],
    staleTime: 10000,
    refetchInterval: 30000,
  });

  const stats = machineData?.stats;
  const machines: any[] = machineData?.machines || [];
  const activeMachines = machines.filter(m => new Date(m.expiresAt) > new Date());
  const expiredMachines = machines.filter(m => new Date(m.expiresAt) <= new Date());

  const walletBalance = parseFloat(user?.walletBalance || "0");
  const gramBalance = walletBalance / AXN_PER_GRAM;

  const buyMutation = useMutation({
    mutationFn: async (machineType: string) => {
      const res = await apiRequest("POST", "/api/machines/buy", { machineType });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: (data) => {
      showNotification(data.message, "success");
      setConfirmMachine(null);
      refetchMachines();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setTab("my");
    },
    onError: (err: any) => {
      showNotification(err?.message || "Purchase failed. Try again.", "error");
      setConfirmMachine(null);
    },
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/machines/claim", {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: (data) => {
      showNotification(data.message, "success");
      refetchMachines();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: (err: any) => {
      showNotification(err?.message || "Claim failed. Try again.", "error");
    },
  });

  const unclaimedAxn = stats?.unclaimedAxn ?? 0;
  const canClaim = unclaimedAxn >= 1;

  return (
    <div style={{ height: "100dvh", background: "#0a0a0a", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes machine-pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
        @keyframes machine-glow { 0%,100%{box-shadow:0 0 8px rgba(59,130,246,0.2)} 50%{box-shadow:0 0 20px rgba(59,130,246,0.5)} }
      `}</style>

      <Header onMenuOpen={() => setMenuOpen(true)} />

      {/* Balance bar */}
      <div style={{
        flexShrink: 0,
        paddingTop: "calc(var(--header-height, 62px) + 10px)",
        padding: "calc(var(--header-height, 62px) + 10px) 16px 0",
      }}>
        <div style={{
          background: "linear-gradient(135deg, #0f172a, #1e293b)",
          border: "1px solid rgba(59,130,246,0.2)",
          borderRadius: 14, padding: "14px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 12,
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>
              GRAM Balance
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
              {fmtGram(gramBalance)} <span style={{ fontSize: 13, color: "#3b82f6", fontWeight: 600 }}>GRAM</span>
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              ≈ {Math.floor(walletBalance).toLocaleString()} AXN
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
              1 GRAM = 100K AXN
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {stats?.activeMachines ?? 0} active machine{stats?.activeMachines !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ flexShrink: 0, padding: "0 16px 12px" }}>
        <div style={{
          display: "flex", background: "#111827", borderRadius: 10, padding: 3, gap: 2,
        }}>
          {([["shop", "Shop"], ["my", "My Machines"]] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                flex: 1, height: 34, borderRadius: 8, border: "none",
                background: tab === id ? "#1d4ed8" : "transparent",
                color: tab === id ? "#fff" : "rgba(255,255,255,0.45)",
                fontSize: 13, fontWeight: tab === id ? 700 : 500, cursor: "pointer",
                transition: "all 0.2s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}
            >
              {label}
              {id === "my" && (stats?.activeMachines ?? 0) > 0 && (
                <span style={{
                  background: "#3b82f6", color: "#fff", borderRadius: 8,
                  fontSize: 9, fontWeight: 800, padding: "1px 5px", minWidth: 16, textAlign: "center",
                }}>
                  {stats.activeMachines}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px", paddingBottom: 90 }}>

        {/* ── SHOP TAB ── */}
        {tab === "shop" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "center", marginBottom: 4 }}>
              Purchase a machine with AXN. Earn passive GRAM rewards every hour.
            </div>
            {MACHINE_TYPES.map(m => (
              <MachineCard key={m.id} machine={m} onBuy={setConfirmMachine} />
            ))}
          </div>
        )}

        {/* ── MY MACHINES TAB ── */}
        {tab === "my" && (
          <>
            {/* Stats summary */}
            {machines.length > 0 && (
              <div style={{
                background: "linear-gradient(135deg, #0f172a, #111827)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 14, padding: "14px 16px", marginBottom: 14,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
                  Overall Stats
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                  {[
                    { label: "Total Machines",    value: stats?.totalMachines ?? 0,                                unit: "" },
                    { label: "Hourly Income",     value: fmtAxn(stats?.hourlyAxn ?? 0),                           unit: " AXN" },
                    { label: "Daily Income",      value: fmtAxn(stats?.dailyAxn ?? 0),                            unit: " AXN" },
                    { label: "Unclaimed",         value: fmtAxn(unclaimedAxn),                                    unit: " AXN" },
                  ].map(stat => (
                    <div key={stat.label} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>{stat.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{stat.value}{stat.unit}</div>
                    </div>
                  ))}
                </div>

                {/* Claim button */}
                <button
                  onClick={() => claimMutation.mutate()}
                  disabled={!canClaim || claimMutation.isPending}
                  style={{
                    width: "100%", height: 44, borderRadius: 10, border: "none",
                    background: canClaim
                      ? "linear-gradient(135deg, #059669, #10b981)"
                      : "#1f2937",
                    color: canClaim ? "#fff" : "#4b5563",
                    fontSize: 14, fontWeight: 700, cursor: canClaim ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                  className="active:scale-95 transition-transform"
                >
                  {claimMutation.isPending ? "Claiming..." : (
                    canClaim
                      ? `Claim ${fmtAxn(unclaimedAxn)} AXN`
                      : "No rewards yet"
                  )}
                </button>
              </div>
            )}

            {/* Active machines */}
            {activeMachines.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                  Active ({activeMachines.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  {activeMachines.map(m => <ActiveMachineCard key={m.id} machine={m} />)}
                </div>
              </>
            )}

            {/* Expired machines */}
            {expiredMachines.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                  Expired ({expiredMachines.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  {expiredMachines.map(m => <ActiveMachineCard key={m.id} machine={m} />)}
                </div>
              </>
            )}

            {/* Empty state */}
            {machines.length === 0 && (
              <div style={{ textAlign: "center", padding: "48px 0" }}>
                <div style={{
                  width: 72, height: 72, borderRadius: "50%",
                  background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 16px",
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(59,130,246,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2"/>
                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                    <line x1="12" y1="12" x2="12" y2="16"/>
                    <line x1="10" y1="14" x2="14" y2="14"/>
                  </svg>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>
                  No machines yet
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 20 }}>
                  Buy a machine from the Shop to start earning passive AXN
                </div>
                <button
                  onClick={() => setTab("shop")}
                  style={{
                    height: 40, padding: "0 24px", borderRadius: 10, border: "none",
                    background: "linear-gradient(135deg, #1d4ed8, #3b82f6)",
                    color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  Browse Shop
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirm popup */}
      {confirmMachine && (
        <ConfirmPopup
          machine={confirmMachine}
          gramBalance={gramBalance}
          onConfirm={() => buyMutation.mutate(confirmMachine.id)}
          onCancel={() => setConfirmMachine(null)}
          loading={buyMutation.isPending}
        />
      )}

      {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
