const positionStyles: Record<string, string> = {
  C: "bg-red-100 text-red-700 ring-red-200 dark:bg-red-500/20 dark:text-red-300 dark:ring-red-500/30",
  LW: "bg-green-100 text-green-700 ring-green-200 dark:bg-green-500/20 dark:text-green-300 dark:ring-green-500/30",
  RW: "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:ring-blue-500/30",
  D: "bg-teal-100 text-teal-700 ring-teal-200 dark:bg-teal-500/20 dark:text-teal-300 dark:ring-teal-500/30",
  G: "bg-purple-100 text-purple-700 ring-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:ring-purple-500/30",
};

export function normalizePosition(position?: string | null) {
  const code = (position || "—").toUpperCase();
  if (code === "L") return "LW";
  if (code === "R") return "RW";
  return code;
}

export default function PositionBadge({ position, className = "" }: { position?: string | null; className?: string }) {
  const code = normalizePosition(position);
  const style = positionStyles[code] || "bg-gray-100 text-gray-700 ring-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600";
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-black ring-1 ${style} ${className}`}>{code}</span>;
}
