import React from 'react';
import { Users } from 'lucide-react';
import { useCloudSync } from '../../hooks/useCloudSync';

/**
 * Shows colored avatar circles of online team members.
 * Only visible when cloud is connected and a workspace is linked.
 */
const CloudPresenceBar: React.FC = () => {
  const cloud = useCloudSync();

  // Don't render when cloud isn't active or no workspace linked
  if (!cloud.configured || !cloud.loggedIn || !cloud.linkedWorkspace) return null;

  const members = cloud.onlineMembers || [];
  if (members.length === 0) return null;

  const maxVisible = 5;
  const visible = members.slice(0, maxVisible);
  const overflow = members.length - maxVisible;

  // Generate a consistent color from a string
  const colorFromId = (id: string) => {
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500',
      'bg-amber-500', 'bg-pink-500', 'bg-cyan-500',
      'bg-indigo-500', 'bg-rose-500',
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="flex items-center gap-1" title={`${members.length} team member${members.length !== 1 ? 's' : ''} online`}>
      <Users size={12} className="text-zinc-500 mr-0.5" />
      <div className="flex -space-x-1.5">
        {visible.map((member) => (
          <div
            key={member.userId}
            className="relative group"
          >
            {member.avatarUrl ? (
              <img
                src={member.avatarUrl}
                alt={member.displayName}
                className="w-5 h-5 rounded-full border border-zinc-800 ring-1 ring-zinc-900"
              />
            ) : (
              <div
                className={`w-5 h-5 rounded-full border border-zinc-800 ring-1 ring-zinc-900 flex items-center justify-center text-[8px] font-bold text-white ${colorFromId(member.userId)}`}
              >
                {(member.displayName || '?')[0].toUpperCase()}
              </div>
            )}
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-zinc-900 border border-zinc-700/50 rounded-md text-[10px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
              {member.displayName || 'Team member'}
              {member.status && member.status !== 'active' && (
                <span className="text-zinc-500 ml-1">({member.status})</span>
              )}
            </div>
          </div>
        ))}
        {overflow > 0 && (
          <div className="w-5 h-5 rounded-full bg-zinc-700 border border-zinc-800 ring-1 ring-zinc-900 flex items-center justify-center text-[8px] font-medium text-zinc-300">
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
};

export default CloudPresenceBar;
