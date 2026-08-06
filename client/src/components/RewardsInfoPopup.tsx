import { X } from "lucide-react";

type Props = { onClose: () => void };

export default function RewardsInfoPopup({ onClose }: Props) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }} />
      <div
        onClick={event => event.stopPropagation()}
        style={{ position: "relative", width: "100%", maxWidth: 390, background: "#0d0d0d", borderRadius: 20, padding: "22px 18px 20px", boxShadow: "0 20px 70px rgba(0,0,0,0.55)" }}
      >
        <button aria-label="Close" onClick={onClose} style={{ position: "absolute", top: 13, right: 13, border: "none", background: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer" }}>
          <X size={19} />
        </button>
        <div style={{ color: "#fff", fontSize: 17, fontWeight: 900, marginBottom: 18 }}>Rewards Information</div>
        <div style={{ display: "grid", gap: 16, color: "rgba(255,255,255,0.48)", fontSize: 12, lineHeight: 1.5 }}>
          <div><strong style={{ color: "#3b82f6" }}>Friend Reward</strong><br />Your referred friend must collect <strong style={{ color: "#fff" }}>100 AXN</strong>. Once they reach 100 AXN, you automatically receive <strong style={{ color: "#fff" }}>1,000 CIPHER</strong>.</div>
          <div><strong style={{ color: "#3b82f6" }}>Deposit Commission</strong><br />Earn <strong style={{ color: "#fff" }}>5%</strong> from every deposit made by your referred friends.</div>
          <div><strong style={{ color: "#3b82f6" }}>Automatic Rewards</strong><br />All referral rewards and deposit commissions are credited automatically. No manual claim is required.</div>
        </div>
      </div>
    </div>
  );
}