interface GRAMIconProps {
  size?: number;
  className?: string;
}

/** Compact GRAM currency mark, kept visually aligned with AXNIcon. */
export function GRAMIcon({ size = 26, className = "" }: GRAMIconProps) {
  return (
    <span
      className={`flex-shrink-0 inline-flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #a855f7, #7c3aed)",
        color: "#fff",
        fontSize: Math.max(11, Math.round(size * 0.52)),
        fontWeight: 900,
        lineHeight: 1,
        fontFamily: "Arial, sans-serif",
      }}
      aria-label="GRAM"
    >
      G
    </span>
  );
}