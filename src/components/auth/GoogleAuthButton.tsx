/**
 * Shared Google OAuth Button & Official Google Brand G Mark
 * Uses Google's standard four-color G proportions on a clean light button surface
 * matching XOS authentication form geometry and accessible states.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { SECONDARY_BUTTON_CLASS } from '../ui/FormControls';

export const GoogleBrandLogo: React.FC<{ className?: string }> = ({ className = 'w-4 h-4 shrink-0' }) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
    />
  </svg>
);

interface GoogleAuthButtonProps {
  label: 'Continue with Google' | 'Start with Google';
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export const GoogleAuthButton: React.FC<GoogleAuthButtonProps> = ({
  label,
  loading = false,
  disabled = false,
  onClick
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`${SECONDARY_BUTTON_CLASS} w-full min-h-[48px] px-4 py-2.5 text-sm font-medium bg-white hover:bg-[#f5f5f7] text-[#1d1d1f] border border-black/[0.12] rounded-xl gap-2.5`}
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin text-[#6e6e73]" aria-hidden="true" />
          <span>Connecting to Google...</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        <>
          <GoogleBrandLogo />
          <span>{label}</span>
        </>
      )}
    </button>
  );
};
