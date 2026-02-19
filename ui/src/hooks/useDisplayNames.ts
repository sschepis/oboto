import { useEffect, useState, useCallback } from 'react';
import { wsService } from '../services/wsService';

export interface DisplayNames {
  /** User's name — shown instead of "You" in chat messages */
  userName: string | null;
  /** Agent's name — shown instead of "Nexus" in chat messages */
  agentName: string | null;
}

/**
 * useDisplayNames — manages dynamic display names for chat participants.
 *
 * Listens to the `ui-display-names` WS event emitted when the agent
 * learns the user's name or when a persona is activated.
 */
export function useDisplayNames() {
  const [displayNames, setDisplayNames] = useState<DisplayNames>({
    userName: null,
    agentName: null,
  });

  useEffect(() => {
    const unsub = wsService.on('ui-display-names', (payload: unknown) => {
      const data = payload as Partial<DisplayNames>;
      setDisplayNames(prev => ({
        userName: data.userName !== undefined ? data.userName : prev.userName,
        agentName: data.agentName !== undefined ? data.agentName : prev.agentName,
      }));
    });

    return unsub;
  }, []);

  /** Resolved label for user messages (falls back to "You"). */
  const userLabel = displayNames.userName || 'You';

  /** Resolved label for agent messages (falls back to "Nexus"). */
  const agentLabel = displayNames.agentName || 'Nexus';

  /** Programmatically update display names from the client side. */
  const updateNames = useCallback((names: Partial<DisplayNames>) => {
    setDisplayNames(prev => ({
      userName: names.userName !== undefined ? names.userName : prev.userName,
      agentName: names.agentName !== undefined ? names.agentName : prev.agentName,
    }));
  }, []);

  return {
    displayNames,
    userLabel,
    agentLabel,
    updateNames,
  };
}
