import { useState, useEffect, useRef } from 'react';
import type { Message, Command, TestResults, OpenClawStatus, ConfirmationRequest } from '../types';
import { wsService } from '../services/wsService';
import { generateMockResponse } from '../services/mockAgent';
import { type ProjectStatusData } from '../components/features/ProjectStatus';
import { type AgentSettings } from '../components/features/SettingsDialog';

export interface FileNode {
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

const INITIAL_MESSAGES: Message[] = [
];

const LS_CWD_KEY = 'ai-man:workspace-cwd';

export interface ActivityLogEntry {
  id: number;
  level: string;
  message: string;
  timestamp: string;
}

export interface ConversationInfo {
  name: string;
  isDefault: boolean;
  messageCount: number;
  createdAt?: string;
  updatedAt?: string;
  parentReports?: Array<{ from: string; summary: string; status: string; timestamp: string }>;
}

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [isWorking, setIsWorking] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [projectStatus, setProjectStatus] = useState<ProjectStatusData | null>(null);
  const [nextSteps, setNextSteps] = useState<Command[]>([]);
  const [settings, setSettings] = useState<AgentSettings>({ maxTurns: 30, maxSubagents: 1 });
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [allLogs, setAllLogs] = useState<ActivityLogEntry[]>([]);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [openClawStatus, setOpenClawStatus] = useState<OpenClawStatus | null>(null);
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null);
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [activeConversation, setActiveConversation] = useState<string>('chat');
  const [workspaceSwitching, setWorkspaceSwitching] = useState(false);
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<string[]>([]);
  const logIdRef = useRef(0);
  const allLogIdRef = useRef(0);
  
  // Keep ref in sync with state for access in effects/callbacks without dependency loops
  useEffect(() => { queueRef.current = messageQueue; }, [messageQueue]);
  
  // We keep a ref to tasks to update the messages efficiently or just rely on messages state
  // But updating a specific message deep in the array requires finding it.
  
  useEffect(() => {
    wsService.connect();
    
    const unsubs = [
      wsService.on('connected', () => {
        setIsConnected(true);
        // Restore persisted workspace from localStorage
        const savedCwd = localStorage.getItem(LS_CWD_KEY);
        if (savedCwd) {
          // setCwd will trigger a status-update from the server with the new cwd,
          // so we do NOT call getStatus() here to avoid a race condition where
          // getStatus() returns the server's old/default cwd and overwrites localStorage.
          wsService.setCwd(savedCwd);
        } else {
          wsService.getStatus();
        }
        wsService.getSettings();
        wsService.getFiles();
        wsService.getOpenClawStatus();
      }),
      wsService.on('disconnected', () => setIsConnected(false)),
      wsService.on('status', (payload: unknown) => {
        const working = payload === 'working';
        setIsWorking(working);
        if (working) {
          // Clear activity log when a new work cycle starts
          setActivityLog([]);
          logIdRef.current = 0;
        }
      }),
      wsService.on('status-update', (payload: unknown) => {
        const status = payload as ProjectStatusData;
        setProjectStatus(status);
        // Persist workspace path to localStorage
        if (status.cwd) {
          localStorage.setItem(LS_CWD_KEY, status.cwd);
          // Refresh file tree when workspace changes
          wsService.getFiles();
        }
      }),
      wsService.on('log', (payload: unknown) => {
        const p = payload as { level: string; message: string; metadata?: unknown };
        const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); // Keep activity log as time-only for brevity

        // Activity log (recent, cleared per work cycle — shown in ThinkingIndicator)
        setActivityLog(prev => {
          const entry: ActivityLogEntry = {
            id: ++logIdRef.current,
            level: p.level,
            message: p.message,
            timestamp: ts,
          };
          const next = [...prev, entry];
          if (next.length > 50) next.shift();
          return next;
        });

        // All logs (persistent buffer — shown in LogPanel)
        setAllLogs(prev => {
          const entry: ActivityLogEntry = {
            id: ++allLogIdRef.current,
            level: p.level,
            message: p.message,
            timestamp: ts,
          };
          const next = [...prev, entry];
          if (next.length > 500) return next.slice(-500);
          return next;
        });
      }),
      wsService.on('next-steps', (payload: unknown) => {
        setNextSteps(payload as Command[]);
      }),
      wsService.on('settings', (payload: unknown) => {
        const newSettings = payload as AgentSettings;
        setSettings(newSettings);
        // Set default model from agentic route if not already set
        setSelectedModel(prev => prev || newSettings.routing?.agentic || null);
      }),
      wsService.on('history-loaded', (payload: unknown) => {
        setMessages(payload as Message[]);
        // Clear workspace-switching state once the server has sent the new history
        setWorkspaceSwitching(false);
        // Cancel the safety timeout since we got a real response
        if (switchTimeoutRef.current) {
          clearTimeout(switchTimeoutRef.current);
          switchTimeoutRef.current = null;
        }
      }),
      wsService.on('file-tree', (payload: unknown) => {
        setFileTree(payload as FileNode[]);
      }),

      wsService.on('openclaw-status', (payload: unknown) => {
          setOpenClawStatus(payload as OpenClawStatus);
      }),

      wsService.on('tool-confirmation-request', (payload: unknown) => {
          setConfirmationRequest(payload as ConfirmationRequest);
      }),
      
      wsService.on('message', (payload: unknown) => {
          const incoming = payload as Message;
          setMessages(prev => {
              // Check if there's a pending response message to merge into
              const pendingIdx = prev.findIndex(m => m._pending === true && m.role === 'ai');
              if (pendingIdx !== -1) {
                  // Merge: set the content and remove pending flag
                  const pendingMsg = prev[pendingIdx];
                  const merged: Message = {
                      ...pendingMsg,
                      content: incoming.content || '',
                      _pending: undefined,
                  };
                  // Preserve timestamp from incoming if available
                  if (incoming.timestamp) merged.timestamp = incoming.timestamp;
                  const newMsgs = [...prev];
                  newMsgs[pendingIdx] = merged;
                  return newMsgs;
              }
              // No pending message — just append (text-only response, no tools were called)
              return [...prev, incoming];
          });
      }),
      
      wsService.on('tool-start', (payload: unknown) => {
         const p = payload as { toolName: string; args: unknown };
         setIsWorking(true);
         setMessages(prev => {
             const newToolCall = {
                 toolName: p.toolName,
                 args: p.args,
                 result: undefined,
                 status: 'running' as const,
             };
             
             // Check if there's already a pending response message to add to
             const pendingIdx = prev.findIndex(m => m._pending === true && m.role === 'ai');
             
             if (pendingIdx !== -1) {
                 // Add tool call to existing pending response
                 const pendingMsg = prev[pendingIdx];
                 const updatedMsg: Message = {
                     ...pendingMsg,
                     toolCalls: [...(pendingMsg.toolCalls || []), newToolCall]
                 };
                 const newMsgs = [...prev];
                 newMsgs[pendingIdx] = updatedMsg;
                 return newMsgs;
             } else {
                 // Create a new pending response message with this tool call
                 const responseMsg: Message = {
                     id: `response-${Date.now()}`,
                     role: 'ai',
                     type: 'text',
                     content: '',
                     toolCalls: [newToolCall],
                     timestamp: new Date().toLocaleString(),
                     _pending: true,
                 };
                 return [...prev, responseMsg];
             }
         });
      }),
      
      wsService.on('tool-end', (payload: unknown) => {
         const p = payload as { toolName: string; result: unknown };
         setMessages(prev => {
             // Find the pending response message containing this tool call
             const pendingIdx = prev.findIndex(m => m._pending === true && m.role === 'ai');
             if (pendingIdx !== -1) {
                 const pendingMsg = prev[pendingIdx];
                 if (pendingMsg.toolCalls) {
                     const toolIdx = pendingMsg.toolCalls.findIndex(
                         tc => tc.toolName === p.toolName && tc.status === 'running'
                     );
                     if (toolIdx !== -1) {
                         const updatedToolCalls = [...pendingMsg.toolCalls];
                         updatedToolCalls[toolIdx] = {
                             ...updatedToolCalls[toolIdx],
                             result: p.result,
                             status: 'completed',
                         };
                         const updatedMsg: Message = { ...pendingMsg, toolCalls: updatedToolCalls };
                         const newMsgs = [...prev];
                         newMsgs[pendingIdx] = updatedMsg;
                         return newMsgs;
                     }
                 }
             }
             return prev;
         });
      }),

      wsService.on('test-results', (payload: unknown) => {
        const testResults = payload as TestResults;
        setMessages(prev => [...prev, {
          id: `test-results-${Date.now()}`,
          role: 'ai',
          type: 'test-results',
          testResults,
          content: `Test run complete: ${testResults.totalPassed} passed, ${testResults.totalFailed} failed, ${testResults.totalPending} pending`,
          timestamp: new Date().toLocaleString()
        }]);
      }),

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      wsService.on('progress', (_payload: unknown) => {
         // Progress events are informational; tool progress is tracked via tool-start/tool-end.
         // The activity log (ThinkingIndicator) already shows progress details.
         // No message mutation needed.
      }),

      // --- Conversation management events ---
      wsService.on('conversation-list', (payload: unknown) => {
        setConversations(payload as ConversationInfo[]);
      }),
      wsService.on('conversation-switched', (payload: unknown) => {
        const p = payload as { name: string; switched?: boolean };
        if (p.name) {
          setActiveConversation(p.name);
        }
      }),
      wsService.on('conversation-renamed', () => {
        wsService.listConversations();
      }),
    ];

    return () => {
      unsubs.forEach(u => u());
      if (switchTimeoutRef.current) {
        clearTimeout(switchTimeoutRef.current);
        switchTimeoutRef.current = null;
      }
    };
  }, []);

  const send = (text: string, activeSurfaceId?: string) => {
    // If working, queue the message
    if (isWorking) {
      setMessageQueue(prev => [...prev, text]);
      // Ref is synced via effect, but sync immediately for consistent logic within this tick if needed
      // (Effect handles it for next render, but for synchronous logic here we could update ref too)
      return;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      type: 'text',
      content: text,
      timestamp: new Date().toLocaleString()
    };
    setMessages(prev => [...prev, userMsg]);

    if (isConnected) {
      setIsWorking(true); // Optimistically set working state
      wsService.send(text, activeSurfaceId, selectedModel || undefined);
    } else {
      setIsWorking(true);
      setTimeout(() => {
        setIsWorking(false);
        setMessages(prev => [...prev, generateMockResponse(text)]);
      }, 1000);
    }
  };

  const stop = () => {
    if (isConnected) {
      wsService.interrupt();
    }
    // Optimistically clear local queue if desired, or let server idle state handle it?
    // User probably wants to cancel current task AND maybe clear queue?
    // Requirement said: "Stop button to interrupt the ai agent."
    // If I interrupt, the agent stops. The queue remains. 
    // If I have queued messages, should they be cleared? 
    // Usually "Stop" stops everything.
    // I'll clear the queue too.
    setMessageQueue([]);
    queueRef.current = [];
  };

  // Process queue when agent becomes idle
  useEffect(() => {
    // Use ref to check queue without dependency on messageQueue state (avoids loops)
    if (!isWorking && queueRef.current.length > 0) {
      const nextMsg = queueRef.current[0];
      const remaining = queueRef.current.slice(1);
      
      // Update state and ref
      setMessageQueue(remaining);
      queueRef.current = remaining;
      
      // Send immediately
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        type: 'text',
        content: nextMsg,
        timestamp: new Date().toLocaleString()
      };
      setMessages(prev => [...prev, userMsg]);

      if (isConnected) {
        wsService.send(nextMsg);
      } else {
        setIsWorking(true);
        setTimeout(() => {
          setIsWorking(false);
          setMessages(prev => [...prev, generateMockResponse(nextMsg)]);
        }, 1000);
      }
    }
  }, [isWorking, isConnected]);

  const setCwd = (path: string) => {
    // Persist immediately so it survives page refresh even before server confirms
    localStorage.setItem(LS_CWD_KEY, path);
    if (isConnected) {
      // Optimistically clear conversation state — server will send the new workspace's data.
      // Set workspaceSwitching so the UI can show a loading indicator instead of an empty chat.
      setWorkspaceSwitching(true);
      setMessages([]);
      setConversations([]);
      setActiveConversation('chat');
      // Clear any previous timeout
      if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
      // Fallback: clear switching state if server never responds (e.g. loadConversation failure)
      switchTimeoutRef.current = setTimeout(() => setWorkspaceSwitching(false), 10_000);
      wsService.setCwd(path);
    }
  };

  /** Delete a single message by id */
  const deleteMessage = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
    wsService.deleteMessage(id);
  };

  /** Edit a user message and rerun: updates content, removes all subsequent messages, re-sends */
  const editAndRerun = (id: string, newContent: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      const updated = { ...prev[idx], content: newContent };
      return [...prev.slice(0, idx), updated]; // truncate everything after
    });
    // Re-send after state update
    setTimeout(() => {
      if (isConnected) {
        wsService.send(newContent);
      } else {
        setIsWorking(true);
        setTimeout(() => {
          setIsWorking(false);
          setMessages(prev => [...prev, generateMockResponse(newContent)]);
        }, 1000);
      }
    }, 0);
  };

  /** Rerun from a user message (same content): removes subsequent messages and re-sends */
  const rerunFromUser = (id: string) => {
    const msg = messages.find(m => m.id === id);
    if (!msg || msg.role !== 'user' || !msg.content) return;
    const content = msg.content;
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      return prev.slice(0, idx + 1); // keep the user message, truncate after
    });
    setTimeout(() => {
      if (isConnected) {
        wsService.send(content);
      } else {
        setIsWorking(true);
        setTimeout(() => {
          setIsWorking(false);
          setMessages(prev => [...prev, generateMockResponse(content)]);
        }, 1000);
      }
    }, 0);
  };

  /** Regenerate an AI response: find preceding user message, remove from AI msg onward, re-send */
  const regenerateFromAI = (aiMessageId: string) => {
    const idx = messages.findIndex(m => m.id === aiMessageId);
    if (idx === -1) return;
    // Walk backward to find the preceding user text message
    let userContent: string | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].type === 'text' && messages[i].content) {
        userContent = messages[i].content!;
        break;
      }
    }
    if (!userContent) return;
    // Truncate from the AI message onward
    setMessages(prev => prev.slice(0, idx));
    const content = userContent;
    setTimeout(() => {
      if (isConnected) {
        wsService.send(content);
      } else {
        setIsWorking(true);
        setTimeout(() => {
          setIsWorking(false);
          setMessages(prev => [...prev, generateMockResponse(content)]);
        }, 1000);
      }
    }, 0);
  };

  const respondToConfirmation = (decision: 'approved' | 'denied' | 'always-allow') => {
      if (confirmationRequest) {
          wsService.sendConfirmationResponse(confirmationRequest.id, decision);
          setConfirmationRequest(null);
      }
  };

  // --- Conversation management actions ---
  const createConversation = (name: string) => {
    wsService.createConversation(name);
  };

  const switchConversation = (name: string) => {
    if (name === activeConversation) return;
    wsService.switchConversation(name);
  };

  const deleteConversation = (name: string) => {
    wsService.deleteConversation(name);
  };

  const renameConversation = (oldName: string, newName: string) => {
    wsService.renameConversation(oldName, newName);
  };

  const refreshConversations = () => {
    wsService.listConversations();
  };

  return {
    messages,
    isWorking,
    workspaceSwitching,
    queueCount: messageQueue.length,
    send,
    stop,
    isConnected,
    projectStatus,
    setCwd,
    nextSteps,
    settings,
    updateSettings: (s: AgentSettings) => wsService.updateSettings(s),
    fileTree,
    deleteMessage,
    editAndRerun,
    rerunFromUser,
    regenerateFromAI,
    activityLog,
    allLogs,
    logPanelOpen,
    setLogPanelOpen,
    clearAllLogs: () => { setAllLogs([]); allLogIdRef.current = 0; },
    openClawStatus,
    configureOpenClaw: wsService.configureOpenClaw.bind(wsService),
    deployOpenClaw: wsService.deployOpenClaw.bind(wsService),
    confirmationRequest,
    respondToConfirmation,
    selectedModel,
    setSelectedModel,
    // Conversation management
    conversations,
    activeConversation,
    createConversation,
    switchConversation,
    deleteConversation,
    renameConversation,
    refreshConversations,
  };
};
