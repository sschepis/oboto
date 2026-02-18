import { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { wsService } from '../../services/wsService';
import { Loader2, Save } from 'lucide-react';

export interface FileEditorHandle {
  save: () => void;
}

interface FileEditorProps {
  filePath: string;
  onDirtyChange?: (filePath: string, isDirty: boolean) => void;
}

// Detect language from file path and content
function detectLanguage(filePath: string, content: string = ''): string {
  const fileName = filePath.split('/').pop()?.toLowerCase() || '';
  const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';

  const extMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css', scss: 'scss', less: 'less',
    html: 'html', htm: 'html',
    xml: 'xml', svg: 'xml',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    yml: 'yaml', yaml: 'yaml',
    toml: 'ini',
    sql: 'sql',
    graphql: 'graphql', gql: 'graphql',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    txt: 'plaintext',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp',
    lua: 'lua',
    pl: 'perl',
    swift: 'swift',
    kt: 'kotlin',
    r: 'r',
    bat: 'bat', cmd: 'bat',
    ps1: 'powershell',
    tf: 'hcl',
    conf: 'ini',
    properties: 'ini',
    ini: 'ini'
  };

  if (extMap[ext]) return extMap[ext];

  const fileMap: Record<string, string> = {
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'jenkinsfile': 'groovy',
    'vagrantfile': 'ruby',
    'gemfile': 'ruby',
    'rakefile': 'ruby',
    'package.json': 'json',
  };
  if (fileMap[fileName]) return fileMap[fileName];

  // Content-based detection
  const header = content.slice(0, 1000);
  const firstLine = header.split('\n')[0].trim();
  
  if (firstLine.startsWith('#!')) {
    if (firstLine.includes('node')) return 'javascript';
    if (firstLine.includes('python')) return 'python';
    if (firstLine.includes('bash') || firstLine.includes('sh') || firstLine.includes('zsh')) return 'shell';
    if (firstLine.includes('ruby')) return 'ruby';
    if (firstLine.includes('php')) return 'php';
    if (firstLine.includes('perl')) return 'perl';
  }

  if (header.includes('<?php')) return 'php';
  if (header.match(/<!DOCTYPE html>/i) || header.match(/<html/i)) return 'html';
  
  // JSON detection - minimal check for performance on large files
  const trimmedStart = content.trimStart();
  if (trimmedStart.startsWith('{') || trimmedStart.startsWith('[')) {
    // Only parse if relatively small to avoid freezing
    if (content.length < 50000) {
      try {
        JSON.parse(content);
        return 'json';
      } catch { /* ignore */ }
    }
  }

  return 'plaintext';
}

/**
 * Inner editor component — receives content after it's loaded.
 * Keyed on filePath so it remounts cleanly per file.
 */
const FileEditorInner = forwardRef<FileEditorHandle, {
  filePath: string;
  initialContent: string;
  onDirtyChange?: (filePath: string, isDirty: boolean) => void;
}>(({ filePath, initialContent, onDirtyChange }, ref) => {
  const language = detectLanguage(filePath, initialContent);
  const [saving, setSaving] = useState(false);
  const savedContentRef = useRef(initialContent);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    const unsub = wsService.on('file-saved', (payload: unknown) => {
      const p = payload as { path: string };
      if (p.path === filePath) {
        setSaving(false);
        if (editorRef.current) {
          savedContentRef.current = editorRef.current.getValue();
        }
        onDirtyChange?.(filePath, false);
      }
    });
    return () => {
        unsub();
        completionProviderRef.current?.dispose();
    };
  }, [filePath, onDirtyChange]);

  const handleSave = useCallback(() => {
    if (editorRef.current) {
      setSaving(true);
      wsService.saveFile(filePath, editorRef.current.getValue());
    }
  }, [filePath]);

  // Expose save to parent via ref
  useImperativeHandle(ref, () => ({
    save: handleSave,
  }), [handleSave]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    // Register AI CodeSense Provider
    // Dispose previous if any (though useEffect handles unmount, this handles remount on same instance if that happens)
    completionProviderRef.current?.dispose();
    
    completionProviderRef.current = monaco.languages.registerInlineCompletionsProvider(language, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provideInlineCompletions: async (model: any, position: any, _context: any, token: any) => {
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        
        const completion = await wsService.requestCompletion({
          filePath,
          language,
          content: text,
          cursorOffset: offset,
          line: position.lineNumber,
          column: position.column
        });

        if (!completion || token.isCancellationRequested) return { items: [] };

        return {
          items: [{
            insertText: completion,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column + completion.length
            )
          }]
        };
      },
      freeInlineCompletions: () => {}
    });
  };

  const handleChange = (value: string | undefined) => {
    if (value !== undefined) {
      onDirtyChange?.(filePath, value !== savedContentRef.current);
    }
  };

  return (
    <div className="flex-1 flex flex-col relative">
      {saving && (
        <div className="absolute top-2 right-4 z-10 flex items-center gap-1.5 text-[10px] text-indigo-400 bg-zinc-900/90 backdrop-blur-sm px-2.5 py-1.5 rounded-lg border border-indigo-500/20 shadow-lg shadow-indigo-500/10 animate-fade-in">
          <Save size={10} className="animate-glow-pulse" /> Saving...
        </div>
      )}
      <Editor
        height="100%"
        language={language}
        defaultValue={initialContent}
        theme="vs-dark"
        onMount={handleEditorMount}
        onChange={handleChange}
        options={{
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          minimap: { enabled: true, maxColumn: 80 },
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          wordWrap: 'on',
          tabSize: 2,
          bracketPairColorization: { enabled: true },
          padding: { top: 8 },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
        }}
      />
    </div>
  );
});

FileEditorInner.displayName = 'FileEditorInner';

/**
 * Loader wrapper: fetches file content, then renders the inner editor.
 * Use `key={filePath}` on this component so it remounts per file.
 */
const FileEditor = forwardRef<FileEditorHandle, FileEditorProps>(({ filePath, onDirtyChange }, ref) => {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = wsService.on('file-content', (payload: unknown) => {
      const p = payload as { path: string; content: string };
      if (p.path === filePath) {
        setContent(p.content);
      }
    });

    const unsubErr = wsService.on('error', (payload: unknown) => {
      const msg = payload as string;
      if (msg.includes('read file')) {
        setError(msg);
      }
    });

    wsService.readFile(filePath);

    return () => {
      unsub();
      unsubErr();
    };
  }, [filePath]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0e0e0e]">
        <div className="text-red-400/80 text-xs font-medium animate-fade-in">{error}</div>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0e0e0e]">
        <div className="flex items-center gap-2 text-zinc-600 text-xs animate-fade-in">
          <Loader2 size={14} className="animate-spin text-indigo-400/40" />
          <span className="font-mono">{filePath.split('/').pop()}</span>
        </div>
      </div>
    );
  }

  return (
    <FileEditorInner
      ref={ref}
      filePath={filePath}
      initialContent={content}
      onDirtyChange={onDirtyChange}
    />
  );
});

FileEditor.displayName = 'FileEditor';

export default FileEditor;
