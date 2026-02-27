import React, { useEffect, useRef } from 'react';
import { Loader2, Package } from 'lucide-react';
import type { SkillInfo } from '../../hooks/useSkills';

interface SkillsSidebarPanelProps {
  installedSkills: SkillInfo[];
  isLoading: boolean;
  onFetchSkills: () => void;
}

const sourceDot: Record<string, string> = {
  global: 'bg-indigo-400',
  clawhub: 'bg-emerald-400',
  npm: 'bg-amber-400',
  workspace: 'bg-purple-400',
};

const SkillsSidebarPanel: React.FC<SkillsSidebarPanelProps> = ({
  installedSkills,
  isLoading,
  onFetchSkills,
}) => {
  // Fetch only once on mount.  The ref guard prevents duplicate calls even
  // if the parent passes an unstable inline arrow for onFetchSkills.
  const fetchRef = useRef(onFetchSkills);
  fetchRef.current = onFetchSkills;
  useEffect(() => {
    fetchRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading && installedSkills.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={14} className="text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (installedSkills.length === 0) {
    return (
      <div className="flex flex-col items-center py-6 text-zinc-600 text-[11px] gap-1.5 px-2 text-center">
        <Package size={18} className="text-zinc-700" />
        <span>No skills installed</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {installedSkills.map(skill => (
        <div
          key={skill.name}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800/30 transition-colors group"
        >
          {/* Source color dot */}
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sourceDot[skill.source] || sourceDot.global}`} />
          <div className="flex-1 min-w-0">
            <span className="text-[11px] text-zinc-300 truncate block">{skill.name}</span>
          </div>
          <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-600 shrink-0">
            {skill.source}
          </span>
        </div>
      ))}
    </div>
  );
};

export default SkillsSidebarPanel;
