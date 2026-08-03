import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency } from "@/lib/utils";
import { RiCheckFill, RiCloseFill, RiInformationFill } from "react-icons/ri";

export type NotificationType = "success" | "error" | "info";

interface NotificationData {
  message: string;
  type?: NotificationType;
  amount?: number;
  duration?: number;
}

let notificationQueue: NotificationData[] = [];
let isDisplaying = false;
let recentNotifications: Map<string, number> = new Map();

const DUPLICATE_PREVENTION_WINDOW = 2000;

export default function AppNotification() {
  const [isVisible, setIsVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [type, setType] = useState<NotificationType>("success");

  const showNextNotification = () => {
    if (notificationQueue.length === 0 || isDisplaying) return;
    isDisplaying = true;
    const notification = notificationQueue.shift()!;
    setMessage(notification.message);
    setType(notification.type || "success");
    setIsVisible(true);
    const displayDuration = notification.duration || 1800;
    setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => {
        isDisplaying = false;
        showNextNotification();
      }, 300);
    }, displayDuration);
  };

  useEffect(() => {
    const handleNotification = (event: CustomEvent<NotificationData>) => {
      const { message: msg, type: notifType, amount, duration } = event.detail;
      let finalMessage = msg;
      if (amount !== undefined) {
        finalMessage = `${msg} +${formatCurrency(amount, false)}`;
      }
      const notificationKey = `${finalMessage}-${notifType}`;
      const now = Date.now();
      const lastShown = recentNotifications.get(notificationKey);
      if (lastShown && (now - lastShown) < DUPLICATE_PREVENTION_WINDOW) return;
      recentNotifications.set(notificationKey, now);
      for (const [key, timestamp] of Array.from(recentNotifications.entries())) {
        if (now - timestamp > 5000) recentNotifications.delete(key);
      }
      notificationQueue.push({ message: finalMessage, type: notifType, duration });
      showNextNotification();
    };
    window.addEventListener('appNotification', handleNotification as EventListener);
    return () => window.removeEventListener('appNotification', handleNotification as EventListener);
  }, []);

  if (!isVisible) return null;

  const getIcon = () => {
    switch (type) {
      case "success": return <RiCheckFill className="w-3.5 h-3.5" />;
      case "error":   return <RiCloseFill className="w-3.5 h-3.5" />;
      case "info":    return <RiInformationFill className="w-3.5 h-3.5" />;
      default:        return <RiCheckFill className="w-3.5 h-3.5" />;
    }
  };

  const accent =
    type === "error" ? { border: "rgba(239,68,68,0.5)", icon: "#f87171", bg: "rgba(239,68,68,0.12)" }
    : type === "info" ? { border: "rgba(59,130,246,0.45)", icon: "#60a5fa", bg: "rgba(59,130,246,0.10)" }
    : { border: "rgba(59,130,246,0.5)", icon: "#3b82f6", bg: "rgba(59,130,246,0.12)" };

  const notificationElement = (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[99999] px-3.5 py-2.5 rounded-2xl flex items-center gap-2.5 max-w-[88vw]"
      style={{
        top: 'calc(var(--header-height, 62px) + 10px)',
        background: "rgba(8,8,12,0.96)",
        border: `1px solid ${accent.border}`,
        boxShadow: `0 0 18px rgba(59,130,246,0.12), 0 8px 32px rgba(0,0,0,0.85)`,
        backdropFilter: "blur(12px)",
        animation: isVisible ? "slideDown 0.28s cubic-bezier(0.22,1,0.36,1)" : "slideUp 0.25s ease-in",
        pointerEvents: "auto",
      }}
    >
      <div
        className="flex items-center justify-center w-6 h-6 rounded-lg flex-shrink-0"
        style={{ background: accent.bg, color: accent.icon }}
      >
        {getIcon()}
      </div>
      <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', lineHeight: 1.35, wordBreak: 'break-word', whiteSpace: 'normal' }}>{message}</span>
    </div>
  );

  return createPortal(notificationElement, document.body);
}

export function showNotification(message: string, type: NotificationType = "success", amount?: number, duration?: number) {
  const event = new CustomEvent('appNotification', {
    detail: { message, type, amount, duration }
  });
  window.dispatchEvent(event);
}
