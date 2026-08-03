// User presence tracking — which users currently have the app open
// This module is shared between routes.ts (WebSocket management) and machineMonitor.ts

const onlineUsers = new Set<string>(); // stores internal user UUIDs

export function markUserOnline(userId: string): void {
  onlineUsers.add(userId);
}

export function markUserOffline(userId: string): void {
  // Only mark offline if there are no more sessions for this user
  // (handled by the caller — routes.ts checks before removing)
  onlineUsers.delete(userId);
}

export function isUserOnline(userId: string): boolean {
  return onlineUsers.has(userId);
}

export function getOnlineUserIds(): string[] {
  return Array.from(onlineUsers);
}
