import { setNhlDataScope } from './nhlSaved';
import { useEffect, useState } from 'react';

// Re-read assembled cached datasets after a successful background update.
export function useNhlDataRevision(keys: string[]) {
  const scope = JSON.stringify(keys);
  useEffect(() => { setNhlDataScope(JSON.parse(scope)); return () => setNhlDataScope([]); }, [scope]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setRevision(value => value + 1), 200);
    };
    window.addEventListener('nhl-data-updated', update);
    // Checking local snapshots costs no HTTP request. Expiry/cooldown checks in
    // the cache decide whether a visible page actually needs a refresh.
    const timerId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) update();
    }, 60_000);
    return () => { clearTimeout(timer); window.clearInterval(timerId); window.removeEventListener('nhl-data-updated', update); };
  }, []);
  return revision;
}
