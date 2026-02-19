import { useCallback, useMemo } from 'react';
import type { Message } from '../types';
import type { MessageActions } from '../components/chat/MessageItem';

interface MessageActionsDependencies {
  deleteMessage: (id: string) => void;
  rerunFromUser: (id: string) => void;
  editAndRerun: (id: string, newContent: string) => void;
  regenerateFromAI: (id: string) => void;
}

export function useMessageActions({ 
  deleteMessage, 
  rerunFromUser, 
  editAndRerun, 
  regenerateFromAI 
}: MessageActionsDependencies) {
  
  const handleCopyMessage = useCallback((message: Message) => {
    const text = message.content || '';
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback for non-secure contexts
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  }, []);

  const messageActions: MessageActions = useMemo(() => ({
    onCopy: handleCopyMessage,
    onDelete: deleteMessage,
    onRerun: rerunFromUser,
    onEditAndRerun: editAndRerun,
    onRegenerate: regenerateFromAI,
  }), [handleCopyMessage, deleteMessage, rerunFromUser, editAndRerun, regenerateFromAI]);

  return { messageActions };
}
