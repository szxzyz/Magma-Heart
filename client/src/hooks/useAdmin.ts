import { useAuth } from "./useAuth";

export function useAdmin() {
  const { user, isLoading } = useAuth();
  
  // The server derives this flag only after authenticated Telegram data has
  // been verified. Server authorization remains the source of truth for every
  // admin mutation.
  const isAdmin = Boolean((user as any)?.isAdmin);
  
  console.log('🔍 Admin check:', { isAdmin, user: !!user });
  
  return {
    isAdmin,
    isLoading,
    user
  };
}