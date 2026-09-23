import { useEffect, useState } from 'react';

/**
 * Creates an object URL for a Blob while the component is mounted and revokes it afterwards,
 * so large originals are only exposed to the page while a preview needs them.
 */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    // Syncing React state with an external resource (the object URL) is the intended use here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [blob]);
  return url;
}
