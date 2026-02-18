import { useState, useEffect, useCallback, useRef } from 'react';
import { wsService } from '../services/wsService';

export interface SecretItem {
  name: string;
  category: string;
  description: string;
  isConfigured: boolean;
  source: 'vault' | 'env' | 'none';
  updatedAt: string | null;
}

export interface UseSecretsReturn {
  secrets: SecretItem[];
  categories: string[];
  loading: boolean;
  error: string | null;
  setSecret: (name: string, value: string, category?: string, description?: string) => void;
  deleteSecret: (name: string) => void;
  refresh: () => void;
}

export function useSecrets(): UseSecretsReturn {
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track whether we've received a response so the timeout can be a no-op
  const receivedRef = useRef(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    receivedRef.current = false;
    wsService.sendMessage('get-secrets');
  }, []);

  useEffect(() => {
    receivedRef.current = false;

    const unsubs = [
      wsService.on('secrets-list', (payload: unknown) => {
        receivedRef.current = true;
        const p = payload as { secrets: SecretItem[]; categories: string[] };
        setSecrets(p.secrets);
        setCategories(p.categories);
        setLoading(false);
        setError(null);
      }),
      wsService.on('secret-set', (payload: unknown) => {
        const p = payload as { name: string; success: boolean };
        if (p.success) refresh();
      }),
      wsService.on('secret-deleted', (payload: unknown) => {
        const p = payload as { name: string; success: boolean };
        if (p.success) refresh();
      }),
      wsService.on('error', (payload: unknown) => {
        const msg = payload as string;
        if (typeof msg === 'string' && (msg.includes('secret') || msg.includes('Secret'))) {
          receivedRef.current = true;
          setError(msg);
          setLoading(false);
        }
      }),
      // When WS (re)connects, retry the request — fixes the race where
      // the initial sendMessage fires before the socket is open.
      wsService.on('connected', () => {
        if (!receivedRef.current) {
          wsService.sendMessage('get-secrets');
        }
      }),
    ];

    // Initial load — send request directly to avoid setState in effect body
    wsService.sendMessage('get-secrets');

    // Safety-net timeout: if no response arrives within 5 s, stop the
    // spinner and show an empty vault instead of hanging forever.
    const timeout = setTimeout(() => {
      if (!receivedRef.current) {
        setLoading(false);
        // Don't set an error — the vault may simply be empty / unreachable
      }
    }, 5000);

    return () => {
      unsubs.forEach(u => u());
      clearTimeout(timeout);
    };
  }, [refresh]);

  const setSecret = useCallback(
    (name: string, value: string, category?: string, description?: string) => {
      wsService.sendMessage('set-secret', { name, value, category, description });
    },
    []
  );

  const deleteSecret = useCallback((name: string) => {
    wsService.sendMessage('delete-secret', { name });
  }, []);

  return { secrets, categories, loading, error, setSecret, deleteSecret, refresh };
}
