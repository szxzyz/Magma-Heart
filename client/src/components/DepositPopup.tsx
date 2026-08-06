import { useState, type CSSProperties } from "react";
import { CheckCircle2, Copy, Loader2, WalletCards, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { apiRequest } from "@/lib/queryClient";

const TREASURY = "UQDeroBz4zvOntJ4xuMdiwFtNddMhJ4cGxghF9B7fYz50q8b";
const CIPHER_PER_GRAM = 100_000;

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
] as CSSProperties[];

type Props = { onClose: () => void };
type Status = "idle" | "sending" | "verifying" | "manualVerifying" | "success" | "error";

function parseError(error: any, fallback: string) {
  return error?.message || fallback;
}

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

  const createDeposit = async () => {
    const response = await apiRequest("POST", "/api/cipher-deposit/create", {
      walletAddress: connectedAddress,
      cipherAmount: amount,
    });
    return response.json();
  };

  const waitForDeposit = async (depositId: string) => {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const response = await apiRequest("GET", `/api/cipher-deposit/status/${depositId}`);
      const data = await response.json();
      if (data.success && data.status === "credited") return data;
      if (data.status === "failed") throw new Error(data.message || "Payment verification failed");
      await new Promise(resolve => window.setTimeout(resolve, 5000));
    }
    throw new Error("Payment is still pending. Keep the popup open and try again shortly.");
  };

  const buyCipher = async () => {
    if (!connectedAddress || status === "sending" || status === "verifying" || status === "manualVerifying") return;
    if (!/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
      setStatus("error");
      setMessage("Enter a whole CIPHER amount greater than 0.");
      return;
    }

    try {
      setStatus("sending");
      setMessage("");
      const purchase = await createDeposit();
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 1800,
        messages: [{ address: TREASURY, amount: purchase.tonAmountNano }],
      });
      setStatus("verifying");
      const verified = await waitForDeposit(purchase.purchaseId);
      setStatus("success");
      setMessage(`Balance updated with ${Number(verified.cipherAmount).toLocaleString()} CIPHER.`);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawals"] });
    } catch (error: any) {
      setStatus("error");
      setMessage(parseError(error, "Payment failed or could not be verified."));
    }
  };

  const startManualTransfer = async () => {
    if (!connectedAddress || status === "sending" || status === "verifying" || status === "manualVerifying") return;
    if (!/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
      setStatus("error");
      setMessage("Enter a whole CIPHER amount greater than 0.");
      return;
    }

    try {
      setStatus("manualVerifying");
      setMessage("");
      const deposit = await createDeposit();
      const verified = await waitForDeposit(deposit.purchaseId);
      setStatus("success");
      setMessage(`Manual transfer verified. ${Number(verified.cipherAmount).toLocaleString()} CIPHER credited.`);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawals"] });
    } catch (error: any) {
      setStatus("error");
      setMessage(parseError(error, "Manual transfer could not be verified."));
    }
  };

  const busy = status === "sending" || status === "verifying" || status === "manualVerifying";
  const grams = amount && /^[0-9]+$/.test(amount)
    ? (Number(amount) / CIPHER_PER_GRAM).toFixed(6).replace(/\.?0+$/, "")
    : "0";

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        }}
      />
      <div
        style={{
          clipPath: CUT_LG, padding: "1.5px", background: "rgba(255,255,255,0.08)",
          boxShadow: "0 20px 70px rgba(0,0,0,0.55)", width: "100%", maxWidth: 390,
        }}
      >
      <div
        onClick={event => event.stopPropagation()}
        style={{
          position: "relative", width: "100%", maxHeight: "86vh",
          overflowY: "auto", background: "#0d0d0d", clipPath: CUT_LG,
          padding: "22px 18px 18px",
        }}
      >
        {CORNER_ACCENTS.map((s, i) => (
          <div key={i} style={{ position: "absolute", pointerEvents: "none", ...s, background: "rgba(0,200,255,0.75)", zIndex: 10 }} />
        ))}

        <div style={{ color: "#fff", fontSize: 18, fontWeight: 900, letterSpacing: "0.02em" }}>
          <span>BUY</span> <span style={{ color: "#3b82f6" }}>CIPHER</span>
        </div>
        <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 700, marginTop: 5 }}>1 GRAM = 100,000 CIPHER</div>

        {connectedAddress ? (
          <div
            style={{
              marginTop: 15, width: "100%", boxSizing: "border-box",
              display: "flex", alignItems: "center", gap: 9,
              background: "rgba(37,99,235,0.16)", borderRadius: 12, padding: "10px 12px",
            }}
          >
            <WalletCards size={17} color="#60a5fa" style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, color: "#dbeafe", fontFamily: "monospace", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {connectedAddress.slice(0, 8)}…{connectedAddress.slice(-6)}
            </span>
            <span style={{ color: "#60a5fa", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>Connected</span>
            <button onClick={() => tonConnectUI.disconnect()} style={{ border: "none", background: "none", padding: 0, color: "rgba(255,255,255,0.42)", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => tonConnectUI.openModal()}
            style={{
              marginTop: 15, width: "100%", boxSizing: "border-box",
              display: "flex", alignItems: "center", gap: 9,
              border: "none", borderRadius: 12, padding: "12px 14px",
              background: "#2563eb", color: "#fff", fontSize: 13,
              fontWeight: 800, cursor: "pointer", textAlign: "left",
            }}
          >
            <WalletCards size={17} color="#fff" style={{ flexShrink: 0 }} />
            <span>Connect GRAM Wallet</span>
          </button>
        )}

        <div style={{ marginTop: 14 }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Amount of CIPHER</div>
              <input
                value={amount}
                onChange={event => { setAmount(event.target.value.replace(/\D/g, "")); setStatus("idle"); setMessage(""); }}
                disabled={!connectedAddress || busy || status === "success"}
                inputMode="numeric"
                placeholder="Enter CIPHER amount"
                style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none", borderRadius: 12, padding: "13px 14px", background: "rgba(255,255,255,0.07)", color: "#fff", fontSize: 13, opacity: connectedAddress ? 1 : 0.48 }}
              />
              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, marginTop: 7 }}>Required payment: {grams} GRAM</div>
        </div>

        <div style={{ marginTop: 14, padding: "11px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 12, opacity: connectedAddress ? 1 : 0.55 }}>
          <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, marginBottom: 5 }}>Send GRAM to:</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, color: "#fff", fontFamily: "monospace", fontSize: 10, wordBreak: "break-all" }}>{TREASURY}</span>
            <button
              onClick={copyTreasury}
              aria-label="Copy admin wallet address"
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, border: "none", background: "transparent",
                color: copied ? "#4ade80" : "#93c5fd", padding: 0, cursor: "pointer",
              }}
            >
              <Copy size={16} strokeWidth={2.1} />
            </button>
          </div>
        </div>

        {status === "sending" || status === "verifying" || status === "manualVerifying" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#93c5fd", fontSize: 12, fontWeight: 700, marginTop: 14 }}>
            <Loader2 size={15} style={{ animation: "deposit-spin 1s linear infinite" }} />
            {status === "sending" ? "Opening wallet…" : status === "manualVerifying" ? "Watching for your manual transfer…" : "Verifying payment on blockchain…"}
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
          style={{ width: "100%", marginTop: 16, border: "none", borderRadius: 12, padding: "12px 0", background: connectedAddress && amount && !busy && status !== "success" ? "linear-gradient(135deg,#2563eb,#3b82f6)" : "rgba(255,255,255,0.07)", color: connectedAddress && amount && !busy && status !== "success" ? "#fff" : "rgba(255,255,255,0.25)", fontSize: 13, fontWeight: 800, cursor: connectedAddress && amount && !busy ? "pointer" : "not-allowed" }}
        >
          {status === "success" ? "Balance Updated" : "Buy CIPHER"}
        </button>
        <button
          onClick={startManualTransfer}
          disabled={!connectedAddress || !amount || busy || status === "success"}
          style={{ width: "100%", marginTop: 9, border: "none", borderRadius: 12, padding: "10px 0", background: "rgba(255,255,255,0.07)", color: connectedAddress && amount && !busy && status !== "success" ? "#dbeafe" : "rgba(255,255,255,0.25)", fontSize: 11, fontWeight: 800, cursor: connectedAddress && amount && !busy ? "pointer" : "not-allowed" }}
        >
          I Sent GRAM Manually
        </button>
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, textAlign: "center", lineHeight: 1.4, marginTop: 9 }}>
          Manual transfers are credited only when the sender and exact amount match this connected wallet.
        </div>
        <style>{`@keyframes deposit-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
      </div>
    </div>
  );
}