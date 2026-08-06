import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/Header";
import MenuPopup from "@/components/MenuPopup";
import { MACHINE_TYPES, type MachineType } from "../../../shared/machineTypes";
import { CUT_LG, CUT_SM, CORNER_ACCENTS_LG, cornerAccentStyle, outerBorderStyle, centeredOverlayStyle, backdropStyle } from "@/lib/cutCorner";

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.00$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtGram(axn: number): string {
  return (axn / 100_000).toFixed(3);
}

// ─── Machine Shop Card (NFT-marketplace style) ────────────────────────
function MachineShopCard({ machine, level, onBuy }: { machine: MachineType; level: number; onBuy: (m: MachineType) => void }) {
  const isMaxLevel = level >= 10;

  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      {/* Artwork */}
      <button
        onClick={() => !isMaxLevel && onBuy(machine)}
        style={{
          position: "relative", width: "100%", aspectRatio: "1 / 1",
          clipPath: CUT_SM, overflow: "hidden", border: "1px solid rgba(0,200,255,0.35)", padding: 0,
          background: "#16181d", cursor: isMaxLevel ? "not-allowed" : "pointer", display: "block",
          opacity: isMaxLevel ? 0.62 : 1,
        }}
        className="active:scale-95 transition-transform"
      >
        <img
          src={machine.imageUrl}
          alt={machine.name}
          loading="lazy"
          decoding="async"
          style={{
            width: "100%", height: "100%", objectFit: "cover", display: "block",
            objectPosition: machine.imagePosition ?? "50% 50%",
            transform: `scale(${machine.imageZoom ?? 1})`, transformOrigin: "center center",
          }}
        />

        {/* Level pill — top left */}
        <div style={{
          position: "absolute", top: 8, left: 8,
          background: isMaxLevel ? "rgba(74,222,128,0.85)" : "rgba(0,0,0,0.55)",
          backdropFilter: "blur(4px)", borderRadius: 20, padding: "3px 8px",
          fontSize: 9, fontWeight: 800, color: isMaxLevel ? "#052e16" : "#fff",
        }}>
          LEVEL {Math.min(level, 10)}/10
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

        {/* Expected reward — bottom left, overlaid on image */}
        <div style={{
          position: "absolute", left: 8, right: 8, bottom: 8,
          background: "rgba(0,0,0,0.62)", backdropFilter: "blur(4px)",
          borderRadius: 12, padding: "6px 9px",
          textAlign: "left",
        }}>
          <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            AXN Reward
          </div>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 900, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
            {fmtNum(machine.totalRoiAxn)} <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 9, fontWeight: 700 }}>({fmtGram(machine.totalRoiAxn)} GRAM)</span>
          </div>
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
        onClick={() => !isMaxLevel && onBuy(machine)}
        disabled={isMaxLevel}
        style={{
          width: "100%", marginTop: 8,
          background: isMaxLevel ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg, #2563eb, #3b82f6)",
          color: isMaxLevel ? "rgba(255,255,255,0.35)" : "#fff", border: "none",
          borderRadius: 10, padding: "8px 0",
          fontSize: 11, fontWeight: 800,
          cursor: isMaxLevel ? "not-allowed" : "pointer", letterSpacing: "0.03em",
          boxShadow: isMaxLevel ? "none" : "0 2px 12px rgba(37,99,235,0.4)",
        }}
        className="active:scale-95 transition-transform"
      >
        {isMaxLevel ? "MAX LEVEL" : "BUY"}
      </button>
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
    <div style={centeredOverlayStyle()}>
      <div style={backdropStyle()} onClick={onCancel} />
      <div style={outerBorderStyle(390)}>
      <div
        onClick={event => event.stopPropagation()}
        style={{
          position: "relative", background: "#0d0d0f", clipPath: CUT_LG,
          width: "100%", padding: "24px 20px 22px", maxHeight: "86vh", overflowY: "auto",
        }}
      >
        {CORNER_ACCENTS_LG.map((s, i) => (
          <div key={i} style={{ ...cornerAccentStyle, ...s }} />
        ))}

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

  const machines: any[] = machineData?.machines || [];
  const levels = machines.reduce<Record<string, number>>((counts, machine) => {
    counts[machine.machineType] = (counts[machine.machineType] || 0) + 1;
    return counts;
  }, {});
  const getLevel = (machineType: string) => Math.min(10, levels[machineType] || 0);
  const cipherBalance = parseFloat(user?.balance || "0");

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

  return (
    <div style={{ height: "100dvh", background: "#0a0a0a", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Header onMenuOpen={() => setMenuOpen(true)} />

      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
        padding: "8px clamp(12px, 4vw, 20px)",
        paddingTop: "calc(var(--header-height, 62px) + 12px)",
        paddingBottom: "max(90px, calc(env(safe-area-inset-bottom, 0px) + 90px))",
      }}>

        {/* ─── NFT MARKETPLACE ─── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.3px" }}>
            <span style={{ color: "#fff" }}>NFT </span>
            <span style={{ color: "#3b82f6" }}>Marketplace</span>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4, lineHeight: 1.5 }}>
            Buy NFTs using CIPHER. Manage farming progress and claim AXN on the Rewards page.
          </div>
        </div>

        {([
          { name: "Common", machines: MACHINE_TYPES.slice(0, 2) },
          { name: "Uncommon", machines: MACHINE_TYPES.slice(2, 4) },
          { name: "Rare", machines: MACHINE_TYPES.slice(4, 6) },
          { name: "Legendary", machines: MACHINE_TYPES.slice(6, 8) },
        ] as const).map(category => (
          <section key={category.name} style={{ marginBottom: 18 }}>
            <div style={{
              color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 800,
              letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 9,
            }}>
              {category.name}
            </div>
            <div
              style={{
                display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 12, width: "100%",
              }}
            >
              {category.machines.map(m => (
                <MachineShopCard key={m.id} machine={m} level={getLevel(m.id)} onBuy={setConfirmMachine} />
              ))}
            </div>
          </section>
        ))}
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
