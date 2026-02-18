import React from 'react';
import type { ConfirmationRequest } from '../../types';
import { AlertTriangle, Check, ShieldCheck, X } from 'lucide-react';

interface ConfirmationDialogProps {
  request: ConfirmationRequest;
  onConfirm: () => void;
  onDeny: () => void;
  onAlwaysAllow: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ request, onConfirm, onDeny, onAlwaysAllow }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-gray-900 border border-red-500/30 rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 bg-red-500/10 border-b border-red-500/20 flex items-center gap-3">
          <div className="p-2 bg-red-500/20 rounded-full">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Security Confirmation</h3>
            <p className="text-xs text-red-300">External Access Request</p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-gray-300 text-sm leading-relaxed">
            The AI assistant is attempting to access a path outside of the current workspace.
          </p>
          
          <div className="bg-black/40 rounded border border-gray-800 p-3 font-mono text-xs overflow-x-auto text-gray-400">
             <div className="mb-1 text-gray-500 uppercase tracking-wider text-[10px]">Action</div>
             <div className="text-blue-400 font-bold">{request.toolName}</div>
             
             <div className="mt-2 mb-1 text-gray-500 uppercase tracking-wider text-[10px]">Arguments</div>
             <pre className="whitespace-pre-wrap">
               {JSON.stringify(request.args, null, 2)}
             </pre>
          </div>
          
          {request.message && (
             <div className="text-xs text-yellow-500/80 italic">
                {request.message}
             </div>
          )}

          {request.pathPrefix && (
             <div className="text-xs text-gray-500">
                Directory: <span className="text-gray-300 font-mono">{request.pathPrefix}</span>
             </div>
          )}

          <p className="text-gray-400 text-xs">
            Do you want to allow this action?
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-950/50 flex justify-end gap-3">
          <button
            onClick={onDeny}
            className="px-4 py-2 rounded text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Deny
          </button>
          
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded text-sm font-medium bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/20 transition-all flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Allow Once
          </button>

          <button
            onClick={onAlwaysAllow}
            className="px-4 py-2 rounded text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
            title={request.pathPrefix ? `Always allow access to ${request.pathPrefix}` : 'Always allow this path'}
          >
            <ShieldCheck className="w-4 h-4" />
            Always Allow
          </button>
        </div>
      </div>
    </div>
  );
};
