import { useSyncExternalStore } from 'react';
import { getNhlStatuses, subscribeNhlStatus } from '../../lib/nhlSaved';

export default function NhlDataNotice() {
  const statuses = useSyncExternalStore(subscribeNhlStatus, getNhlStatuses, getNhlStatuses);
  const saved = statuses.filter(item => item.saved && item.updatedAt);
  if (!saved.length) return null;
  const oldest = saved.reduce((a, b) => a.updatedAt! < b.updatedAt! ? a : b);
  const season = oldest.dataset?.match(/^(?:skaters|goalies):\d{4}(\d{4})|^live-season:(\d{4})/);
  const label = season ? ` (${season[1] || season[2]} season)` : '';
  const message = saved.find(item => item.message)?.message;
  return <p role="status" className="mb-4 text-sm text-gray-500 dark:text-gray-400">
    {message || (saved.some(item => item.refreshing) ? 'Showing saved NHL statistics. Updating in the background.' : 'Saved NHL statistics available.')}
    {' '}Oldest saved data in use: {new Date(oldest.updatedAt!).toLocaleString()}{label}.
  </p>;
}
