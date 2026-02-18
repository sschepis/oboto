import React, { useEffect } from 'react';
import html2canvas from 'html2canvas';
import { wsService } from '../../services/wsService';

export const ScreenshotManager: React.FC = () => {
  useEffect(() => {
    const unsub = wsService.on('request-screenshot', async (payload: unknown) => {
        const { requestId, surfaceId } = payload as { requestId: string; surfaceId: string };
        console.log(`[ScreenshotManager] Received request for surface: ${surfaceId} (req: ${requestId})`);

        try {
            const element = document.getElementById(`surface-${surfaceId}`);
            if (!element) {
                console.error(`[ScreenshotManager] Element not found: #surface-${surfaceId}`);
                wsService.sendMessage('screenshot-captured', { 
                    requestId, 
                    error: `Surface element #${surfaceId} not found in DOM` 
                });
                return;
            }

            // Capture the element
            // useCORS: true is often needed for external images, though surfaces are mostly local
            // logging: false to reduce noise
            const canvas = await html2canvas(element, {
                useCORS: true,
                logging: false,
                backgroundColor: '#080808' // Match theme background
            });

            const image = canvas.toDataURL('image/jpeg', 0.8);
            
            wsService.sendMessage('screenshot-captured', {
                requestId,
                image
            });
            console.log(`[ScreenshotManager] Screenshot sent for surface: ${surfaceId}`);

        } catch (error) {
            console.error('[ScreenshotManager] Capture failed:', error);
            wsService.sendMessage('screenshot-captured', {
                requestId,
                error: `Capture failed: ${(error as Error).message}`
            });
        }
    });

    return () => {
        unsub();
    };
  }, []);

  return null; // Headless component
};
