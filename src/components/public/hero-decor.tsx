/** Purely decorative background flourishes for the hero panel — all aria-hidden, all static. */

export function DotGrid({ className }: { className?: string }) {
  return (
    <svg className={`pointer-events-none absolute h-24 w-24 opacity-40 ${className ?? ""}`} aria-hidden="true">
      <pattern id="hero-dot-grid" width="14" height="14" patternUnits="userSpaceOnUse">
        <circle cx="1.5" cy="1.5" r="1.5" fill="var(--color-primary)" />
      </pattern>
      <rect width="100%" height="100%" fill="url(#hero-dot-grid)" />
    </svg>
  );
}

export function LeafBlob({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 220"
      className={`pointer-events-none absolute h-56 w-56 opacity-50 ${className ?? ""}`}
      aria-hidden="true"
    >
      <path
        d="M20 200 C10 140 30 70 90 40 C150 10 210 40 205 100 C200 150 160 150 130 175 C100 200 35 240 20 200 Z"
        fill="var(--color-secondary)"
        opacity="0.18"
      />
      <path
        d="M35 200 C28 150 45 95 95 68 C140 44 185 62 180 105 C176 140 145 142 120 162 C95 182 47 228 35 200 Z"
        fill="var(--color-secondary)"
        opacity="0.22"
      />
    </svg>
  );
}

export function DiagonalAccentLine() {
  return (
    <svg className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block" aria-hidden="true">
      <line x1="100%" y1="60%" x2="88%" y2="10%" stroke="var(--color-primary)" strokeOpacity="0.18" strokeWidth="1.5" strokeDasharray="1 6" strokeLinecap="round" />
    </svg>
  );
}
