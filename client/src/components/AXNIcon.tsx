interface AXNIconProps {
  size?: number;
  className?: string;
}

// Daily Rewards icons use a 26px visual reference. Keep the currency mark at
// the same default size so it remains balanced across pages.
export function AXNIcon({ size = 26, className = "" }: AXNIconProps) {
  return (
    <span
      className={`flex-shrink-0 inline-block ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        overflow: 'hidden',
        display: 'inline-block',
        position: 'relative',
      }}
    >
      <img
        src="/axn-coin.jpg"
        alt="AXN"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%) scale(1.18)',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </span>
  );
}
