/**
 * React hook that subscribes to the Support LLM service status.
 *
 * Returns the current {@link SupportLlmStatus} and re-renders
 * automatically whenever the status changes.
 *
 * @see ui/src/services/supportLlmService.ts
 */

import { useState, useEffect } from 'react';
import { supportLlmService } from '../services/supportLlmService';
import type { SupportLlmStatus } from '../services/supportLlmService';

export function useSupportLlmStatus(): SupportLlmStatus {
  const [status, setStatus] = useState<SupportLlmStatus>(() => supportLlmService.getStatus());

  useEffect(() => {
    const unsub = supportLlmService.onStatusChange(setStatus);
    return unsub;
  }, []);

  return status;
}
