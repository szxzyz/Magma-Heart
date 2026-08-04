import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/Header";
import MenuPopup from "@/components/MenuPopup";
import { MACHINE_TYPES, type MachineType } from "../../../shared/machineTypes";

// ─── Helpers ────────────────────────────────────────────────────────
function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.00$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

// ─── Machine Shop Card (NFT-marketplace style) ────────────────────────
// NOTE: card artwork is a placeholder gradient + monogram for now.
// Once real artwork is provided, swap the placeholder block below for
// an <img src={machine.imageUrl} /> — layout (pills, name, button) stays the same.
const CARD_GRADIENTS = [
  "linear-gradient(160deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)",
  "linear-gradient(160deg, #312e81 0%, #4338ca 55%, #6366f1 100%)",
  "linear-gradient(160deg, #164e63 0%, #0e7490 55%, #22d3ee 100%)",
  "linear-gradient(160deg, #7c2d12 0%, #c2410c 55%, #fb923c 100%)",
  "linear-gradient(160deg, #3f0d1e 0%, #9f1239 55%, #f43f5e 100%)",
  "linear-gradient(160deg, #052e16 0%, #15803d 55%, #4ade80 100%)",
  "linear-gradient(160deg, #422006 0%, #a16207 55%, #facc15 100%)",
  "linear-gradient(160deg, #2e1065 0%, #7e22ce 55%, #c084fc 100%)",
];

function MachineShopCard({ machine, index, onBuy }: { machine: MachineType; index: number; onBuy: (m: MachineType) => void }) {
  const gradient = CARD_GRADIENTS[index % CARD_GRADIENTS.length];

  return (
    <div style={{ width: 152, flexShrink: 0, scrollSnapAlign: "start" }}>
      {/* Artwork */}
      <button
        onClick={() => onBuy(machine)}
        style={{
          position: "relative", width: "100%", aspectRatio: "1 / 1",
          borderRadius: 16, overflow: "hidden", border: "none", padding: 0,
          background: gradient, cursor: "pointer", display: "block",
        }}
        className="active:scale-95 transition-transform"
      >
        {/* Monogram placeholder */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 34, fontWeight: 900, color: "rgba(255,255,255,0.28)",
          letterSpacing: "-0.5px",
        }}>
          {machine.name.slice(0, 2).toUpperCase()}
        </div>

        {/* Duration pill — top right */}
        <div style={{
          position: "absolute", top: 8, right: 8,
          background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
          borderRadius: 20, padding: "3px 8px",
          fontSize: 9, fontWeight: 800, color: "#fff",
        }}>
          {machine.durationDays}d
        </div>

        {/* Price pill — bottom left, overlaid on image */}
        <div style={{
          position: "absolute", left: 8, right: 8, bottom: 8,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
          borderRadius: 20, padding: "5px 8px",
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
            <img src="/cipher-icon.jpg" alt="CIPHER" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
            {fmtNum(machine.priceCipher)}
          </span>
        </div>
      </button>

      {/* Name + rate */}
      <div style={{ marginTop: 8, padding: "0 2px" }}>
        <div style={{ color: "#fff", fontSize: 13, fontWeight: 800, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {machine.name}
        </div>
        <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 2, whiteSpace: "nowrap" }}>
          {fmtNum(machine.hourlyAxn)} AXN/hr
        </div>
      </div>

      {/* Buy button */}
      <button
        onClick={() => onBuy(machine)}
        style={{
          width: "100%", marginTop: 8,
          background: "linear-gradient(135deg, #2563eb, #3b82f6)",
          color: "#fff", border: "none",
          borderRadius: 10, padding: "8px 0",
          fontSize: 11, fontWeight: 800,
          cursor: "pointer", letterSpacing: "0.03em",
          boxShadow: "0 2px 12px rgba(37,99,235,0.4)",
        }}
        className="active:scale-95 transition-transform"
      >
        BUY
      </button>
    </div>
  );
}

// ─── Owned Machine Card ──────────────────────────────────────────────
function OwnedMachineCard({ machine }: { machine: any }) {
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
      setRemaining(Math.max(0, expiresAt - now));
      const effectiveNow = Math.min(now, expiresAt);
      const elapsedHours = Math.max(0, effectiveNow - lastClaimed) / 3_600_000;
      setUnclaimed(Math.floor(elapsedHours * mType!.hourlyAxn));
    }
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [machine, mType]);

  if (!mType) return null;

  const isExpired = Date.now() >= new Date(machine.expiresAt).getTime();
  const expiresAt = new Date(machine.expiresAt).getTime();
  const purchasedAt = new Date(machine.purchasedAt).getTime();
  const totalDurationMs = mType.durationHours * 3_600_000;
  const elapsed = Date.now() - purchasedAt;
  const progress = Math.min(1, Math.max(0, elapsed / totalDurationMs));

  return (
    <div style={{
      background: "rgba(255,255,255,0.07)",
      borderRadius: 16, padding: "18px 18px",
      marginBottom: 12,
      opacity: isExpired ? 0.55 : 1,
    }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: isExpired ? "rgba(255,255,255,0.04)" : "rgba(74,222,128,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isExpired ? "rgba(255,255,255,0.3)" : "rgba(74,222,128,0.85)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/>
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
              <circle cx="12" cy="14" r="2"/>
            </svg>
          </div>
          <div>
            <div style={{ color: "#fff", fontSize: 15, fontWeight: 800, lineHeight: 1.2 }}>{mType.name}</div>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 3 }}>
              {isExpired ? "Expired" : `${fmtNum(mType.hourlyAxn)} AXN/hr`}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: isExpired ? "rgba(255,255,255,0.25)" : "#4ade80" }}>
            +{fmtNum(unclaimed)}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>AXN unclaimed</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: isExpired ? "rgba(255,255,255,0.1)" : "linear-gradient(90deg, #2563eb, #3b82f6)",
            borderRadius: 3,
            transition: "width 1s linear",
          }} />
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          Earned: {fmtNum(parseFloat(machine.totalClaimedAxn || "0"))} AXN total
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: isExpired ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.55)" }}>
          {fmtCountdown(remaining)}
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Popup ───────────────────────────────────────────────────
function ConfirmPopup({ machine, cipherBalance, onConfirm, onCancel, loading }: {
  machine: MachineType;
  cipherBalance: number;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const canAfford = cipherBalance >= machine.priceCipher;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        background: "#0d0d0f", borderRadius: "18px 18px 0 0",
        border: "1px solid rgba(255,255,255,0.08)",
        width: "100%", maxWidth: 480, padding: "24px 20px 32px",
      }}>
        <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 2, margin: "0 auto 20px" }} />

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Confirm Purchase</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>You are about to buy:</div>
        </div>

        <div style={{
          background: "rgba(255,255,255,0.07)", borderRadius: 14, padding: 16, marginBottom: 16,
        }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 14 }}>{machine.name}</div>
          {[
            { label: "Price",     value: `${machine.priceCipher.toLocaleString()} CIPHER` },
            { label: "Duration",  value: `${machine.durationDays} days` },
            { label: "Hourly",    value: `${fmtNum(machine.hourlyAxn)} AXN/hr` },
            { label: "Daily",     value: `${fmtNum(machine.dailyAxn)} AXN/day` },
            { label: "Total ROI", value: `${fmtNum(machine.totalRoiAxn)} AXN` },
          ].map(row => (
            <div key={row.label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              paddingBottom: 8, marginBottom: 8,
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>{row.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{row.value}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Your Balance</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: canAfford ? "#4ade80" : "#f87171" }}>
              {Math.floor(cipherBalance).toLocaleString()} CIPHER
            </span>
          </div>
        </div>

        {!canAfford && (
          <div style={{
            background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 14,
            fontSize: 12, color: "#f87171", textAlign: "center",
          }}>
            Insufficient CIPHER. Need {machine.priceCipher.toLocaleString()} CIPHER.
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, height: 48, borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent", color: "rgba(255,255,255,0.6)",
              fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canAfford || loading}
            style={{
              flex: 2, height: 48, borderRadius: 12, border: "none",
              background: canAfford ? "linear-gradient(135deg, #2563eb, #3b82f6)" : "rgba(255,255,255,0.06)",
              color: canAfford ? "#fff" : "rgba(255,255,255,0.25)",
              fontSize: 14, fontWeight: 800,
              cursor: canAfford ? "pointer" : "not-allowed",
              opacity: loading ? 0.7 : 1,
              boxShadow: canAfford ? "0 2px 16px rgba(37,99,235,0.4)" : "none",
            }}
          >
            {loading ? "Buying…" : "Confirm Purchase"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────
export default function MachinePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmMachine, setConfirmMachine] = useState<MachineType | null>(null);
  const queryClient = useQueryClient();

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/user"], staleTime: 0 });
  const { data: machineData, refetch: refetchMachines } = useQuery<any>({
    queryKey: ["/api/machines"],
    staleTime: 10000,
    refetchInterval: 30000,
  });

  const stats      = machineData?.stats;
  const machines: any[] = machineData?.machines || [];
  const activeMachines  = machines.filter(m => new Date(m.expiresAt) > new Date());
  const expiredMachines = machines.filter(m => new Date(m.expiresAt) <= new Date());

  const cipherBalance = parseFloat(user?.balance || "0");
  const unclaimedAxn  = stats?.unclaimedAxn ?? 0;
  const canClaim      = unclaimedAxn >= 1;

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

  return (
    <div style={{ height: "100dvh", background: "#0a0a0a", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Header onMenuOpen={() => setMenuOpen(true)} />

      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
        padding: "8px clamp(12px, 4vw, 20px)",
        paddingTop: "calc(var(--header-height, 62px) + 12px)",
        paddingBottom: "max(90px, calc(env(safe-area-inset-bottom, 0px) + 90px))",
      }}>

        {/* ─── YOUR MACHINES ─── */}
        {machines.length > 0 && (
          <>
            {/* Section header */}
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.28)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Your Machines
              </span>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 3 }}>
                {activeMachines.length} active · {fmtNum(stats?.hourlyAxn ?? 0)} AXN/hr
              </div>
            </div>

            {/* Claim rewards bar */}
            <div style={{
              background: "rgba(255,255,255,0.07)",
              borderRadius: 14, padding: "14px 18px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 12,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>
                  {fmtNum(unclaimedAxn)} AXN
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                  Pending rewards
                </div>
              </div>
              <button
                onClick={() => claimMutation.mutate()}
                disabled={!canClaim || claimMutation.isPending}
                style={{
                  background: canClaim ? "linear-gradient(135deg, #2563eb, #3b82f6)" : "rgba(255,255,255,0.06)",
                  color: canClaim ? "#fff" : "rgba(255,255,255,0.25)",
                  border: "none", borderRadius: 10,
                  padding: "10px 20px", fontSize: 12, fontWeight: 800,
                  cursor: canClaim ? "pointer" : "not-allowed",
                  letterSpacing: "0.03em",
                  boxShadow: canClaim ? "0 2px 12px rgba(37,99,235,0.4)" : "none",
                }}
                className="active:scale-95 transition-transform"
              >
                {claimMutation.isPending ? "CLAIMING…" : "CLAIM AXN"}
              </button>
            </div>

            {/* Active machines */}
            {activeMachines.map(m => <OwnedMachineCard key={m.id} machine={m} />)}

            {/* Expired machines */}
            {expiredMachines.length > 0 && (
              <>
                <div style={{ marginTop: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.18)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    Expired
                  </span>
                </div>
                {expiredMachines.map(m => <OwnedMachineCard key={m.id} machine={m} />)}
              </>
            )}

            {/* Divider between sections */}
            <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "8px 0 24px" }} />
          </>
        )}

        {/* ─── NFT MARKETPLACE ─── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", letterSpacing: "-0.3px" }}>
            NFT Marketplace
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4, lineHeight: 1.5 }}>
            Buy NFTs using CIPHER and earn passive AXN rewards until the maximum ROI is reached.
          </div>
        </div>

        {/* Row 1 — first 4 */}
        <div
          className="scrollbar-hide"
          style={{
            display: "flex", gap: 12, overflowX: "auto", overflowY: "hidden",
            WebkitOverflowScrolling: "touch", scrollSnapType: "x mandatory",
            paddingBottom: 4, marginBottom: 16,
          }}
        >
          {MACHINE_TYPES.slice(0, 4).map((m, i) => (
            <MachineShopCard key={m.id} machine={m} index={i} onBuy={setConfirmMachine} />
          ))}
        </div>

        {/* Row 2 — last 4 */}
        <div
          className="scrollbar-hide"
          style={{
            display: "flex", gap: 12, overflowX: "auto", overflowY: "hidden",
            WebkitOverflowScrolling: "touch", scrollSnapType: "x mandatory",
            paddingBottom: 4,
          }}
        >
          {MACHINE_TYPES.slice(4, 8).map((m, i) => (
            <MachineShopCard key={m.id} machine={m} index={i + 4} onBuy={setConfirmMachine} />
          ))}
        </div>
      </div>

      {confirmMachine && (
        <ConfirmPopup
          machine={confirmMachine}
          cipherBalance={cipherBalance}
          onConfirm={() => buyMutation.mutate(confirmMachine.id)}
          onCancel={() => setConfirmMachine(null)}
          loading={buyMutation.isPending}
        />
      )}

      {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
