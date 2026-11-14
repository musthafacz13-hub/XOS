import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[max(0.75rem,env(safe-area-inset-top,0px))] left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-[#111318] text-white px-3.5 py-2 text-xs font-medium shadow-md border border-neutral-800 whitespace-nowrap"
    >
      <WifiOff className="w-3.5 h-3.5 text-[#8ECFFF] shrink-0" />
      <span>You are offline. Changes require an active connection.</span>
    </div>
  );
};
