import React, { useState } from 'react';
import { X, FolderSync, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { MediaItem } from '../types';
import { FolderBrowser } from './FolderBrowser';

interface RelocateModalProps {
  media: MediaItem;
  onClose: () => void;
  onRelocate: (mediaId: string, newPath: string) => Promise<void>;
}

export const RelocateModal: React.FC<RelocateModalProps> = ({
  media,
  onClose,
  onRelocate,
}) => {
  const [newPath, setNewPath] = useState(media.folderPath);
  const [isRelocating, setIsRelocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPath.trim()) {
      setError('Informe o novo caminho da pasta.');
      return;
    }

    setError(null);
    setIsRelocating(true);
    try {
      await onRelocate(media.id, newPath.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao relocalizar pasta');
    } finally {
      setIsRelocating(false);
    }
  };

  return (
    <div
      id="relocate-modal-backdrop"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="relocate-modal"
        className="relative w-full max-w-lg bg-[#181818] rounded-xl overflow-hidden shadow-2xl border border-white/10 p-6 text-neutral-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-blue-950/60 border border-blue-800/60 flex items-center justify-center text-blue-400">
            <FolderSync className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Relocalizar Pasta</h2>
            <p className="text-xs text-neutral-400">
              Atualiza a pasta caso a letra do drive (pendrive) ou diretório tenha mudado
            </p>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800/60 flex items-start space-x-2 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current Info */}
          <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 text-xs">
            <div className="text-neutral-400 mb-1">Caminho atual registrado:</div>
            <div className="font-mono text-neutral-300 break-all">{media.folderPath}</div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Novo Caminho da Pasta
            </label>
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono text-xs"
              required
            />
          </div>

          {/* Quick Folder Browser */}
          <div>
            <div className="text-[11px] text-neutral-400 mb-1">Selecione o novo local:</div>
            <FolderBrowser onSelectPath={(path) => setNewPath(path)} currentSelected={newPath} />
          </div>

          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition-colors"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isRelocating}
              className="flex items-center space-x-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50"
            >
              {isRelocating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Atualizando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Salvar Novo Local</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
