import PopupShell from "@/components/PopupShell";

type Props = { onClose: () => void };

export default function RewardsInfoPopup({ onClose }: Props) {
  return (
    <PopupShell onClose={onClose}>
        <div style={{ color: "#fff", fontSize: 17, fontWeight: 900, marginBottom: 18 }}>Rewards Information</div>
        <div style={{ display: "grid", gap: 16, color: "rgba(255,255,255,0.48)", fontSize: 12, lineHeight: 1.5 }}>
          <div><strong style={{ color: "#3b82f6" }}>Friend Reward</strong><br />Your referred friend must collect <strong style={{ color: "#fff" }}>100 AXN</strong>. Once they reach 100 AXN, you automatically receive <strong style={{ color: "#fff" }}>0.01 GRAM</strong>.</div>
          <div><strong style={{ color: "#3b82f6" }}>Deposit Commission</strong><br />Earn <strong style={{ color: "#fff" }}>5%</strong> from every deposit made by your referred friends.</div>
          <div><strong style={{ color: "#3b82f6" }}>Automatic Rewards</strong><br />All referral rewards and deposit commissions are credited automatically. No manual claim is required.</div>
        </div>
        <button onClick={onClose} style={{ width: "100%", marginTop: 22, border: "none", clipPath: "polygon(8px 0%,calc(100% - 8px) 0%,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0% calc(100% - 8px),0% 8px)", padding: "12px 0", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
          Close
        </button>
    </PopupShell>
  );
}