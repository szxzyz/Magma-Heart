import { useState } from "react";
import { CheckCircle2, Clipboard, Loader2, WalletCards, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { apiRequest } from "@/lib/queryClient";

const TREASURY = "UQDeroBz4zvOntJ4xuMdiwFtNddMhJ4cGxghF9B7fYz50q8b";
const CIPHER_PER_GRAM = 100_000;

type Props = { onClose: () => void };
type Status = "idle" | "sending" | "verifying" | "success" | "error";

export default function DepositPopup({ onClose }: Props) {
  const [tonConnectUI] = useTonConnectUI();
  const connectedAddress = useTonAddress();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const copyTreasury = async () => {
    await navigator.clipboard.writeText(TREASURY);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const verifyPurchase = async (purchaseId: string) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await apiRequest("POST", `/api/cipher-deposit/verify/${purchaseId}`);
      const data = await response.json();
      if (data.success && data.status === "credited") return data;
      if (data.status === "failed") throw new Error(data.message || "Payment verification failed");
      await new Promise(resolve => window.setTimeout(resolve, 4000));
    }
    throw new Error("Payment is not visible on the blockchain yet. Please try Verify again shortly.");
  };

  const buyCipher = async () => {
    if (!connectedAddress || status === "sending" || status === "verifying") return;
    if (!/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
      setStatus("error");
      setMessage("Enter a whole CIPHER amount greater than 0.");
      return;
    }

    try {
      setStatus("sending");
      setMessage("");
      const createResponse = await apiRequest("POST", "/api/cipher-deposit/create", {
        walletAddress: connectedAddress,
        cipherAmount: amount,
      });
      const purchase = await createResponse.json();

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 1800,
        messages: [{ address: TREASURY, amount: purchase.tonAmountNano }],
      });

      setStatus("verifying");
      const verified = await verifyPurchase(purchase.purchaseId);
      setStatus("success");
      setMessage(`Balance updated with ${Number(verified.cipherAmount).toLocaleString()} CIPHER.`);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    } catch (error: any) {
      setStatus("error");
      setMessage(error?.message || "Payment failed or could not be verified.");
    }
  };

  const busy = status === "sending" || status === "verifying";

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }} />
      <div
        onClick={event => event.stopPropagation()}
        style={{
          position: "relative", width: "100%", maxWidth: 390, maxHeight: "86vh",
          overflowY: "auto", background: "#0d0d0d", borderRadius: 20,
          border: "1px solid rgba(255,255,255,0.07)", padding: "22px 18px 18px",
          boxShadow: "0 20px 70px rgba(0,0,0,0.55)",
        }}
      >
        <button
          aria-label="Close"
          onClick={onClose}
          style={{ position: "absolute", top: 12, right: 13, border: "none", background: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}
        >
          ×
        </button>
        <div style={{ color: "#fff", fontSize: 18, fontWeight: 900, letterSpacing: "0.02em" }}>BUY CIPHER</div>
        <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 700, marginTop: 5 }}>1 GRAM = 100,000 CIPHER</div>

        <div style={{ marginTop: 18, background: "rgba(255,255,255,0.055)", borderRadius: 14, padding: 14 }}>
          <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Wallet
          </div>
          {connectedAddress ? (
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <WalletCards size={18} color="#4ade80" />
              <span style={{ flex: 1, color: "#d1fae5", fontFamily: "monospace", fontSize: 12 }}>
                {connectedAddress.slice(0, 8)}…{connectedAddress.slice(-6)}
              </span>
              <button onClick={() => tonConnectUI.disconnect()} style={{ border: "none", background: "none", color: "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <div style={{ color: "#fff", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Connect your wallet first</div>
              <button
                onClick={() => tonConnectUI.openModal()}
                style={{ width: "100%", border: "none", borderRadius: 11, padding: "11px 12px", background: "#2563eb", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}
              >
                Connect GRAM Wallet
              </button>
            </>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Amount of CIPHER</div>
          <input
            value={amount}
            onChange={event => { setAmount(event.target.value.replace(/\D/g, "")); setStatus("idle"); setMessage(""); }}
            disabled={!connectedAddress || busy || status === "success"}
            inputMode="numeric"
            placeholder="Enter the amount of CIPHER you want to buy"
            style={{
              width: "100%", boxSizing: "border-box", border: "none", outline: "none",
              borderRadius: 12, padding: "13px 14px", background: "rgba(255,255,255,0.07)",
              color: "#fff", fontSize: 13, opacity: connectedAddress ? 1 : 0.42,
            }}
          />
        </div>

        <div style={{ marginTop: 14, padding: "11px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 12 }}>
          <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, marginBottom: 5 }}>Send payment to:</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, color: "#fff", fontFamily: "monospace", fontSize: 10, wordBreak: "break-all" }}>{TREASURY}</span>
            <button onClick={copyTreasury} aria-label="Copy admin wallet address" style={{ flexShrink: 0, border: "none", background: "rgba(255,255,255,0.08)", color: copied ? "#4ade80" : "#93c5fd", borderRadius: 8, padding: 8, cursor: "pointer" }}>
              <Clipboard size={14} />
            </button>
          </div>
        </div>

        {status === "sending" || status === "verifying" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#93c5fd", fontSize: 12, fontWeight: 700, marginTop: 14 }}>
            <Loader2 size={15} style={{ animation: "deposit-spin 1s linear infinite" }} />
            {status === "sending" ? "Opening wallet…" : "Verifying payment on blockchain…"}
          </div>
        ) : status === "success" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, color: "#4ade80", fontSize: 12, fontWeight: 700 }}>
            <CheckCircle2 size={17} /> {message}
          </div>
        ) : status === "error" ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14, color: "#f87171", fontSize: 12, lineHeight: 1.4 }}>
            <XCircle size={17} style={{ flexShrink: 0 }} /> {message}
          </div>
        ) : null}

        <button
          onClick={buyCipher}
          disabled={!connectedAddress || !amount || busy || status === "success"}
          style={{
            width: "100%", marginTop: 16, border: "none", borderRadius: 12, padding: "12px 0",
            background: connectedAddress && amount && !busy && status !== "success" ? "linear-gradient(135deg,#2563eb,#3b82f6)" : "rgba(255,255,255,0.07)",
            color: connectedAddress && amount && !busy && status !== "success" ? "#fff" : "rgba(255,255,255,0.25)",
            fontSize: 13, fontWeight: 800, cursor: connectedAddress && amount && !busy ? "pointer" : "not-allowed",
          }}
        >
          {status === "success" ? "Balance Updated" : "Buy CIPHER"}
        </button>
        <style>{`@keyframes deposit-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}