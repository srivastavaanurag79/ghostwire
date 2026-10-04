export function Logo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="GhostWire"
    >
      <defs>
        <linearGradient id="gw-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2AABEE" />
          <stop offset="1" stopColor="#8774E1" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#gw-logo-g)" />
      <g fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="20" strokeLinecap="round">
        <path d="M186 168a96 96 0 0 1 140 0" />
        <path d="M158 132a140 140 0 0 1 196 0" />
      </g>
      <path
        d="M256 168c-72 0-114 52-114 122v84c0 13 13 20 24 12l27-20c7-5 16-4 21 2l19 22c6 8 18 8 24 0l19-22c5-6 14-7 21-2l27 20c11 8 24 1 24-12v-84c0-70-42-122-114-122z"
        fill="#ffffff"
      />
      <circle cx="214" cy="268" r="16" fill="#22314a" />
      <circle cx="298" cy="268" r="16" fill="#22314a" />
    </svg>
  );
}
