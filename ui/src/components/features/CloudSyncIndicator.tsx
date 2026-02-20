import React from 'react';
import { Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';
import { useCloudSync } from '../../hooks/useCloudSync';

/**
 * Small cloud sync status indicator for the status bar.
 * Hidden when cloud is not configured.
 *
 * States:
 * - Not configured → hidden
 * - Not logged in → grey cloud
 * - Logged in, idle → blue cloud
 * - Syncing → spinning refresh
 * - Synced → blue cloud with checkmark
 * - Error → red cloud
 * - Offline → grey cloud-off
 */
const CloudSyncIndicator: React.FC = () => {
  const cloud = useCloudSync();

  // Don't render when cloud is not configured
  if (!cloud.configured) return null;

  const getIcon = () => {
    if (!cloud.loggedIn) {
      return <CloudOff size={13} className="text-zinc-600" />;
    }

    switch (cloud.syncState) {
      case 'syncing':
        return <RefreshCw size={13} className="text-blue-400 animate-spin" />;
      case 'error':
        return <AlertCircle size={13} className="text-red-400" />;
      case 'offline':
        return <CloudOff size={13} className="text-zinc-500" />;
      case 'synced':
        return <Cloud size={13} className="text-blue-400" />;
      default: // idle
        return <Cloud size={13} className="text-zinc-400" />;
    }
  };

  const getTooltip = () => {
    if (!cloud.loggedIn) return 'Cloud: not signed in';
    if (cloud.linkedWorkspace) {
      const wsName = cloud.linkedWorkspace.name || 'workspace';
      switch (cloud.syncState) {
        case 'syncing': return `Syncing with ${wsName}...`;
        case 'synced': return `Synced with ${wsName}`;
        case 'error': return `Sync error with ${wsName}`;
        case 'offline': return 'Cloud offline';
        default: return `Linked to ${wsName}`;
      }
    }
    return `Cloud: ${cloud.profile?.displayName || cloud.user?.email || 'connected'}`;
  };

  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-800/40 cursor-default transition-colors"
      title={getTooltip()}
    >
      {getIcon()}
      {cloud.loggedIn && cloud.linkedWorkspace && (
        <span className="text-[10px] text-zinc-500 max-w-[80px] truncate">
          {cloud.linkedWorkspace.name}
        </span>
      )}
    </div>
  );
};

export default CloudSyncIndicator;
