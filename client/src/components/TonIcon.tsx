interface TonIconProps {
  size?: number;
  className?: string;
}

/** Official TON roundel used for TON payment and wallet UI. */
export function TonIcon({ size = 17, className = "" }: TonIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      aria-label="TON"
      role="img"
      className={className}
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}
    >
      <path d="M28 0C12.536 0 0 12.536 0 28s12.536 28 28 28 28-12.536 28-28S43.464 0 28 0z" fill="#0098EA"/>
      <path d="M37.115 15.5H18.885c-3.4 0-5.5 3.7-3.7 6.6l10.3 17.8c.8 1.4 2.8 1.4 3.6 0l10.3-17.8c1.7-2.9-.3-6.6-3.7-6.6zm-10.5 16.5l-6.4-11.1h6.4v11.1zm2.8 0V20.9h6.4l-6.4 11.1z" fill="white"/>
    </svg>
  );
}