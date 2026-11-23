import { useState } from 'react';

// Headshots are static assets. Do not fetch a full NHL player profile to render
// one: those API calls share the live-data origin's rate-limit cooldown.
export default function NhlHeadshot({ playerId, name, className = "h-full w-full object-contain object-bottom",
  fallbackClassName = "mb-7 text-2xl font-black text-gray-400", loading = "lazy" }: {
  playerId?: string; name: string; className?: string; fallbackClassName?: string; loading?: "lazy" | "eager";
}) {
  const [failedId, setFailedId] = useState<string>();
  const valid = Boolean(playerId && /^[1-9]\d{0,9}$/.test(playerId));
  if (!valid || failedId === playerId) return <span className={fallbackClassName}>
    {name.split(' ').map(part => part[0]).join('').slice(0, 2)}
  </span>;
  return <img src={`https://assets.nhle.com/mugs/nhl/latest/${playerId}.png`}
    alt={`${name} headshot`} loading={loading} decoding="async"
    className={className} onError={() => setFailedId(playerId)} />;
}
