// Distinct shapes so status never depends on colour: circle-check, triangle-bang, octagon-cross.
export type Status = "pass" | "warn" | "fail" | "safety";

export function StatusIcon({ status }: { status: Status }) {
  const common = { width: 20, height: 20, viewBox: "0 0 20 20", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (status) {
    case "pass":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="8" />
          <path d="M6.2 10.3l2.6 2.6 5-5.4" />
        </svg>
      );
    case "warn":
    case "safety":
      return (
        <svg {...common}>
          <path d="M10 2.5l8 14.5H2z" />
          <path d="M10 8v4M10 14.6v.1" />
        </svg>
      );
    case "fail":
      return (
        <svg {...common}>
          <path d="M6.7 2h6.6L18 6.7v6.6L13.3 18H6.7L2 13.3V6.7z" />
          <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" />
        </svg>
      );
  }
}
