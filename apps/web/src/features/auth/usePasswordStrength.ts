import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  warning: string | null;
  suggestions: string[];
}

/**
 * Debounced strength check. The zxcvbn dictionaries live on the server so the web bundle stays small;
 * a basic length heuristic shows instantly while the request is in flight.
 */
export function usePasswordStrength(password: string, inputs: string[]): Strength | null {
  const [result, setResult] = useState<Strength | null>(null);
  const key = inputs.join('|');
  useEffect(() => {
    if (!password) {
      setResult(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api<Strength>('/api/auth/password-strength', { method: 'POST', body: { password, inputs: inputs.slice(0, 5) }, signal: ctrl.signal })
        .then(setResult)
        .catch(() => setResult({ score: password.length >= 14 ? 3 : password.length >= 10 ? 2 : 1, warning: null, suggestions: [] }));
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password, key]);
  return result;
}
