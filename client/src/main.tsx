import { Component, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import App from "./App";
import "./index.css";

const MANIFEST_URL = `${window.location.origin}/tonconnect-manifest.json`;

document.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("DOMContentLoaded", () => {
  document.body.style.webkitUserSelect = "none";
  document.body.style.userSelect = "none";
  (document.body.style as CSSStyleDeclaration & { webkitTouchCallout?: string }).webkitTouchCallout = "none";
});

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err: unknown) { console.error("[RootErrorBoundary]", err); }
  render() {
    if (this.state.crashed) {
      return (
        <div style={{
          minHeight: "100vh", background: "#000",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: 24, gap: 16,
        }}>
          <img src="/axn-logo.svg" alt="AXN" style={{ width: 64, opacity: 0.6 }} />
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, textAlign: "center", margin: 0 }}>
            Something went wrong. Please reload.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 32px", background: "#2563eb", border: "none",
              borderRadius: 12, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </TonConnectUIProvider>
);
