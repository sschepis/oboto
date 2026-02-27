import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Paperclip, Image as ImageIcon, X, FileText, Zap, Activity, Trash2, Download, GitBranch, Folder, BookOpen, FlaskConical, Code2, Mic, MicOff, Square, Play, Bot, ChevronDown, Check } from 'lucide-react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import VoiceWaveform from '../features/VoiceWaveform';
import AgentActivityPanel from './AgentActivityPanel';
import { wsService } from '../../services/wsService';
import type { Command } from '../../types';
import type { ActivityLogEntry } from '../../hooks/useChat';

interface Attachment {
  id: string;
  name: string;
  type: 'file' | 'image';
  previewUrl?: string;  // data URL for image thumbnails
  size: number;
  uploading: boolean;
  serverPath?: string;  // set after upload completes
}

interface InputAreaProps {
  isAgentWorking: boolean;
  onSend: (text: string, attachments?: { name: string; path: string }[]) => void;
  onStop?: () => void;
  commands?: Command[];
  suggestions?: Command[];
  /** Optional external ref to the textarea for focusing from parent */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  availableModels?: Record<string, { provider: string }>;
  selectedModel?: string | null;
  onSelectModel?: (model: string) => void;
  /** Activity log entries for the agent activity panel */
  activityLog?: ActivityLogEntry[];
  /** Number of queued messages */
  queueCount?: number;
  /** When true, the entire input area is disabled (e.g. no AI providers enabled) */
  disabled?: boolean;
}

const getIcon = (iconName: string | React.ReactNode) => {
  if (React.isValidElement(iconName)) return iconName;
  if (typeof iconName !== 'string') return <Activity size={12} />;

  switch (iconName) {
    case 'download': return <Download size={12} />;
    case 'flask-conical': return <FlaskConical size={12} />;
    case 'git-branch': return <GitBranch size={12} />;
    case 'folder': return <Folder size={12} />;
    case 'book-open': return <BookOpen size={12} />;
    case 'zap': return <Zap size={12} />;
    case 'code': return <Code2 size={12} />;
    default: return <Activity size={12} />;
  }
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix to get raw base64
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

const InputArea: React.FC<InputAreaProps> = ({
  isAgentWorking,
  onSend,
  onStop,
  commands = [
    { id: 'analyze', label: '/analyze', desc: 'Deep system diagnostic', icon: <Zap size={14} /> },
    { id: 'visualize', label: '/visualize', desc: 'Real-time neural map', icon: <Activity size={14} /> },
    { id: 'sandbox', label: '/sandbox', desc: 'Init UI prototype', icon: <Code2 size={14} /> },
    { id: 'clear', label: '/clear', desc: 'Wipe thread memory', icon: <Trash2 size={14} /> },
  ],
  suggestions = [],
  inputRef: externalInputRef,
  availableModels = {},
  selectedModel,
  onSelectModel,
  activityLog,
  queueCount,
  disabled = false,
}) => {
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const hasOpenClawMention = /(?:^|\s)@openclaw\b/i.test(input);
  const [showInlineMenu, setShowInlineMenu] = useState(false);
  const [inlineFilter, setInlineFilter] = useState('');
  const [selectedInlineIndex, setSelectedInlineIndex] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const internalInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);

  const {
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    resetTranscript,
    audioData,
    isSupported: isSpeechSupported
  } = useSpeechRecognition();

  // Progressive transcript update
  useEffect(() => {
    if (transcript) {
      setInput(prev => {
        const trailingSpace = prev.length > 0 && !prev.endsWith(' ');
        return prev + (trailingSpace ? ' ' : '') + transcript;
      });
      resetTranscript();
    }
  }, [transcript, resetTranscript]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [input, inputRef]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const filteredInline = commands.filter(c => c.label.includes(inlineFilter));

  const groupedModels = useMemo(() => {
    const groups: Record<string, string[]> = {};
    Object.entries(availableModels).forEach(([id, info]) => {
      const provider = info.provider || 'unknown';
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(id);
    });
    return groups;
  }, [availableModels]);

  const currentProvider = useMemo(() => {
    if (!selectedModel || !availableModels[selectedModel]) return null;
    return availableModels[selectedModel].provider;
  }, [selectedModel, availableModels]);

  const modelDisplayLabel = useMemo(() => {
    if (!selectedModel) return null;
    return currentProvider ? `${currentProvider}/${selectedModel}` : selectedModel;
  }, [selectedModel, currentProvider]);

  // Close model selector on outside click
  useEffect(() => {
    if (!showModelSelector) return;
    const handleClick = (e: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setShowModelSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showModelSelector]);

  // Close model selector on Escape
  useEffect(() => {
    if (!showModelSelector) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModelSelector(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showModelSelector]);

  const handleSelectModel = (modelId: string) => {
    onSelectModel?.(modelId);
    setShowModelSelector(false);
  };

  // Listen for upload completion
  useEffect(() => {
    const unsub = wsService.on('file-uploaded', (payload: unknown) => {
      const p = payload as { name: string; path: string; size: number };
      setAttachments(prev => prev.map(a => 
        a.name === p.name && a.uploading 
          ? { ...a, uploading: false, serverPath: p.path }
          : a
      ));
    });
    return unsub;
  }, []);

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowInlineMenu(false);
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, []);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const isImage = isImageFile(file);

      // Create preview URL for images
      let previewUrl: string | undefined;
      if (isImage) {
        previewUrl = URL.createObjectURL(file);
      }

      const attachment: Attachment = {
        id,
        name: file.name,
        type: isImage ? 'image' : 'file',
        previewUrl,
        size: file.size,
        uploading: true,
      };

      setAttachments(prev => [...prev, attachment]);

      // Upload via WebSocket
      try {
        const base64 = await fileToBase64(file);
        wsService.uploadFile(file.name, base64, 'base64');
      } catch (err) {
        console.error('Failed to read file for upload:', err);
        setAttachments(prev => prev.filter(a => a.id !== id));
      }
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => {
      const att = prev.find(a => a.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val.startsWith('/')) {
      setShowInlineMenu(true);
      setInlineFilter(val);
      setSelectedInlineIndex(0);
    } else {
      setShowInlineMenu(false);
    }
  };

  const handleSendAction = (text?: string) => {
    const textToSend = text || input;
    if (!textToSend.trim() && attachments.length === 0) return;
    
    // Collect uploaded attachment paths
    const uploadedAttachments = attachments
      .filter(a => !a.uploading && a.serverPath)
      .map(a => ({ name: a.name, path: a.serverPath! }));

    // If there are attachments, append info to the message
    let finalText = textToSend;
    if (uploadedAttachments.length > 0 && !text) {
      const attachInfo = uploadedAttachments.map(a => `[attached: ${a.name}]`).join(' ');
      finalText = finalText.trim() ? `${finalText.trim()} ${attachInfo}` : attachInfo;
    }

    onSend(finalText, uploadedAttachments.length > 0 ? uploadedAttachments : undefined);
    setInput('');
    setShowInlineMenu(false);
    // Clean up previews
    attachments.forEach(a => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    });
    setAttachments([]);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (showInlineMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedInlineIndex(prev => (prev + 1) % filteredInline.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedInlineIndex(prev => (prev - 1 + filteredInline.length) % filteredInline.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredInline.length > 0) {
          e.preventDefault();
          handleSendAction(filteredInline[selectedInlineIndex].label);
        }
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendAction();
    }
  };

  // Handle paste events for files and images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault(); // Prevent pasting file as text
      processFiles(files);
    }
  }, [processFiles]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = ''; // Reset so same file can be re-selected
    }
  };

  return (
    <footer className={`
      border-t bg-[#0a0a0a]/95 sticky bottom-0 z-30 w-full
      transition-all duration-300
      ${isFocused
        ? 'border-indigo-500/20 shadow-[0_-4px_24px_rgba(99,102,241,0.06)]'
        : 'border-zinc-800/40'}
    `}
    style={{ backdropFilter: 'blur(12px)' }}
    >
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handleFileInputChange}
      />

      <div className="w-full relative">
        
        {/* Agent activity panel — always visible above input when working */}
        <AgentActivityPanel
          isAgentWorking={isAgentWorking}
          activityLog={activityLog}
          queueCount={queueCount}
        />

        {showInlineMenu && filteredInline.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#0d0d0d]/95 border border-zinc-800/50 rounded-xl shadow-2xl shadow-black/40 overflow-hidden p-1 mx-3 max-w-xl animate-slide-in-up"
            style={{ backdropFilter: 'blur(16px)' }}
          >
            {filteredInline.map((c, i) => (
              <button key={c.id} onClick={() => handleSendAction(c.label)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150
                  ${i === selectedInlineIndex
                    ? 'bg-indigo-600/10 text-white border border-indigo-500/10'
                    : 'text-zinc-400 hover:bg-zinc-800/40 border border-transparent'}
                `}>
                <div className={`
                  p-1.5 rounded-lg transition-all duration-200
                  ${i === selectedInlineIndex
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'bg-zinc-800/60 text-zinc-500'}
                `}>{c.icon}</div>
                <div className="flex flex-col items-start">
                  <span className={`text-[12px] font-bold ${i === selectedInlineIndex ? 'text-indigo-300' : ''}`}>{c.label}</span>
                  <span className="text-[10px] text-zinc-600">{c.desc}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Suggestion chips */}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-zinc-800/20 animate-fade-in">
            {suggestions.map((a, i) => (
              <button
                key={a.id || i}
                onClick={() => handleSendAction(a.label)}
                className="
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                  bg-zinc-800/30 border border-zinc-800/40
                  text-zinc-400 hover:text-white hover:border-indigo-500/30 hover:bg-indigo-500/5
                  transition-all duration-200 text-[10px] font-bold tracking-tight
                  active:scale-95 hover:shadow-sm hover:shadow-indigo-500/5
                "
                style={{ animationDelay: `${i * 0.05}s` }}
              >
                <span className="text-indigo-400">{getIcon(a.icon)}</span>{a.label}
              </button>
            ))}
          </div>
        )}

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-zinc-800/20 animate-fade-in">
            {attachments.map(att => (
              <div
                key={att.id}
                className={`
                  relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-medium
                  transition-all duration-300 animate-scale-in
                  ${att.uploading
                    ? 'bg-zinc-800/30 border-zinc-700/30 text-zinc-500'
                    : 'bg-zinc-800/20 border-zinc-700/20 text-zinc-300'}
                `}
              >
                {att.uploading && (
                  <div className="absolute inset-0 rounded-lg shimmer pointer-events-none" />
                )}
                {att.type === 'image' && att.previewUrl ? (
                  <img src={att.previewUrl} alt={att.name} className="w-5 h-5 rounded object-cover shrink-0" />
                ) : (
                  <FileText size={12} className="text-zinc-500 shrink-0" />
                )}
                <span className="truncate max-w-[100px]">{att.name}</span>
                <span className="text-zinc-600 text-[9px]">{formatSize(att.size)}</span>
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="ml-0.5 p-0.5 rounded-md hover:bg-zinc-600/30 transition-all duration-150 active:scale-90"
                >
                  <X size={10} className="text-zinc-500" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2 px-3 py-2.5">
          <div className="flex items-center gap-0.5 shrink-0">
             {/* Model Selector */}
             {Object.keys(groupedModels).length > 0 && !disabled && (
              <div className="relative mr-1" ref={modelSelectorRef}>
                <button
                  onClick={() => setShowModelSelector(prev => !prev)}
                  className="p-1.5 flex items-center gap-1 text-zinc-600 hover:text-indigo-400 transition-all duration-200 rounded-lg hover:bg-indigo-500/5 active:scale-90"
                  title={modelDisplayLabel ? `Model: ${modelDisplayLabel}` : 'Select AI Model'}
                >
                  <Bot size={15} />
                  <ChevronDown size={10} className={`opacity-50 transition-transform duration-200 ${showModelSelector ? 'rotate-180' : ''}`} />
                </button>

                {showModelSelector && (
                  <div className="absolute bottom-full left-0 mb-1 w-72 max-h-80 overflow-y-auto bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-2xl shadow-black/60 z-[60] py-1">
                    {Object.entries(groupedModels).map(([provider, models]) => (
                      <div key={provider}>
                        <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500 bg-zinc-800/40 sticky top-0">
                          {provider}
                        </div>
                        {models.map(m => {
                          const isActive = m === selectedModel;
                          return (
                            <button
                              key={m}
                              onClick={() => handleSelectModel(m)}
                              className={`
                                w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors
                                ${isActive
                                  ? 'bg-indigo-500/15 text-indigo-300'
                                  : 'text-zinc-300 hover:bg-white/5 hover:text-white'}
                              `}
                            >
                              <span className="flex-1 truncate">{provider}/{m}</span>
                              {isActive && <Check size={12} className="text-indigo-400 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 text-zinc-600 hover:text-indigo-400 transition-all duration-200 rounded-lg hover:bg-indigo-500/5 active:scale-90"
              title="Attach file"
            >
              <Paperclip size={15} />
            </button>
            <button
              onClick={() => imageInputRef.current?.click()}
              className="p-1.5 text-zinc-600 hover:text-indigo-400 transition-all duration-200 rounded-lg hover:bg-indigo-500/5 active:scale-90"
              title="Attach image"
            >
              <ImageIcon size={15} />
            </button>
            {isSpeechSupported && (
              <button
                onClick={toggleListening}
                className={`
                  p-1.5 transition-all duration-200 rounded-lg active:scale-90
                  ${isListening
                    ? 'text-red-400 hover:text-red-300 bg-red-500/10 shadow-sm shadow-red-500/10'
                    : 'text-zinc-600 hover:text-indigo-400 hover:bg-indigo-500/5'}
                `}
                title={isListening ? "Stop recording" : "Start voice input"}
              >
                {isListening ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
            )}
          </div>
          
          <div className="flex-1 relative">
            {isListening && (
              <div className="absolute bottom-full left-0 mb-2 flex items-center gap-3 bg-zinc-900/90 border border-zinc-700/30 rounded-xl px-4 py-2.5 backdrop-blur-md z-10 w-full max-w-md animate-slide-in-up shadow-lg shadow-black/20">
                <VoiceWaveform data={audioData} />
                <span className="text-zinc-300 text-xs truncate">
                  {interimTranscript || "Listening..."}
                </span>
              </div>
            )}
            <textarea
              ref={inputRef} value={input}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onPaste={handlePaste}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              disabled={disabled}
              placeholder={
                disabled
                  ? "No AI providers enabled — configure in Settings"
                  : isAgentWorking
                    ? "Queue a message..."
                    : "Message Oboto..."
              }
              className={`
                w-full bg-transparent border-none focus:ring-0
                text-[13px] placeholder:text-zinc-400
                resize-none max-h-32 min-h-[28px] py-1 outline-none leading-relaxed
                transition-colors duration-200
                ${disabled ? 'text-zinc-600 cursor-not-allowed' : 'text-white'}
              `}
              rows={1}
            />
          </div>
          {hasOpenClawMention && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold uppercase tracking-wider select-none shrink-0 animate-scale-in">
              <span aria-hidden>🦞</span>OC
            </span>
          )}
          <button
            onClick={() => {
              if (isAgentWorking && !input.trim() && attachments.length === 0) {
                onStop?.();
              } else {
                handleSendAction();
              }
            }}
            disabled={disabled || ((!input.trim() && attachments.length === 0) && !isAgentWorking)}
            className={`
              h-8 w-8 flex items-center justify-center rounded-lg
              transition-all duration-250 shrink-0 active:scale-90
              ${isAgentWorking
                ? (input.trim() || attachments.length > 0)
                  ? 'bg-orange-500 text-black shadow-md shadow-orange-500/20 hover:bg-orange-400'
                  : 'bg-zinc-700 text-zinc-300 hover:text-white hover:bg-red-500/90 shadow-md shadow-black/20'
                : (input.trim() || attachments.length > 0)
                  ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30 hover:-translate-y-0.5'
                  : 'bg-zinc-800/40 text-zinc-600 cursor-not-allowed'}
            `}
          >
            {isAgentWorking 
              ? (input.trim() || attachments.length > 0)
                ? <Play size={14} fill="currentColor" className="ml-0.5" />
                : <Square size={14} fill="currentColor" />
              : <Send size={14} />}
          </button>
        </div>
      </div>
    </footer>
  );
};

export default InputArea;
