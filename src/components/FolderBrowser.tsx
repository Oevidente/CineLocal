import React, { useState, useEffect } from 'react';
import { Folder, FolderOpen, ChevronRight, Video, ArrowUp } from 'lucide-react';
import { BrowseItem } from '../types';

interface FolderBrowserProps {
  onSelectPath: (path: string) => void;
  currentSelected?: string;
}

export const FolderBrowser: React.FC<FolderBrowserProps> = ({
  onSelectPath,
  currentSelected,
}) => {
  const [currentDir, setCurrentDir] = useState<string>('');
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDir = async (dir?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = dir ? `/api/browse?dir=${encodeURIComponent(dir)}` : '/api/browse';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Não foi possível abrir o diretório');
      const data = await res.json();
      setCurrentDir(data.currentDir);
      setParentDir(data.parentDir);
      setItems(data.items);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDir();
  }, []);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 text-sm">
      {/* Current Dir Header with Up navigation */}
      <div className="flex items-center justify-between pb-2 border-b border-neutral-800 mb-2">
        <div className="flex items-center space-x-2 font-mono text-xs text-neutral-300 truncate" title={currentDir}>
          <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="truncate">{currentDir || 'Carregando...'}</span>
        </div>

        {parentDir && (
          <button
            type="button"
            onClick={() => fetchDir(parentDir)}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 transition-colors shrink-0"
            title="Subir um nível"
          >
            <ArrowUp className="w-3 h-3" />
            <span>Subir</span>
          </button>
        )}
      </div>

      {/* Directory list */}
      <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
        {loading ? (
          <div className="text-center py-6 text-xs text-neutral-400">Carregando pastas...</div>
        ) : error ? (
          <div className="text-center py-4 text-xs text-red-400">{error}</div>
        ) : items.length === 0 ? (
          <div className="text-center py-6 text-xs text-neutral-500">Nenhuma subpasta encontrada</div>
        ) : (
          items.map((item) => {
            if (item.name === '..') return null;
            const isSelected = currentSelected === item.path;

            return (
              <div
                key={item.path}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#E50914]/20 border border-[#E50914]/40 text-white font-medium'
                    : 'hover:bg-neutral-800 text-neutral-300'
                }`}
                onClick={() => onSelectPath(item.path)}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="truncate text-xs">{item.name}</span>
                  {item.hasMediaFiles && (
                    <span className="flex items-center space-x-0.5 text-[10px] text-emerald-400 bg-emerald-950/60 px-1 rounded border border-emerald-800/40">
                      <Video className="w-2.5 h-2.5" />
                      <span>Vídeos</span>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchDir(item.path);
                  }}
                  className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-700"
                  title="Abrir pasta"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
