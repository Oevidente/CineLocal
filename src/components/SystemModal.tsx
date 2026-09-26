import React, { useState, useEffect } from 'react';
import { X, HardDrive, CheckCircle, AlertTriangle, Terminal, FileJson, Download, Loader2, Zap, Cpu, Smartphone, Subtitles, Film, Key, RefreshCw, Sparkles, ExternalLink } from 'lucide-react';
import { SystemStatus } from '../types';
import { MobileAccessBanner } from './MobileAccessBanner';

interface SystemModalProps {
  onClose: () => void;
  onRefreshLibrary?: () => Promise<void>;
  onOpenTmdbModal?: () => void;
}

export const SystemModal: React.FC<SystemModalProps> = ({
  onClose,
  onRefreshLibrary,
  onOpenTmdbModal,
}) => {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installingFfmpeg, setInstallingFfmpeg] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [updatingHw, setUpdatingHw] = useState(false);

  // TMDb API Configuration state
  const [tmdbKeyInput, setTmdbKeyInput] = useState('');
  const [isSavingTmdb, setIsSavingTmdb] = useState(false);
  const [tmdbMessage, setTmdbMessage] = useState<string | null>(null);
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null);

  const fetchStatus = () => {
    fetch('/api/system/status')
      .then((res) => res.json())
      .then((data) => setStatus(data))
      .catch((err) => console.error('Error fetching system status:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleSaveTmdbKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tmdbKeyInput.trim()) return;
    setIsSavingTmdb(true);
    setTmdbMessage(null);
    try {
      const res = await fetch('/api/system/tmdb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: tmdbKeyInput.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setTmdbMessage('Chave do TMDb salva com sucesso!');
        setTmdbKeyInput('');
        fetchStatus();
      } else {
        setTmdbMessage(data.error || 'Erro ao salvar chave.');
      }
    } catch {
      setTmdbMessage('Erro ao comunicar com o servidor.');
    } finally {
      setIsSavingTmdb(false);
    }
  };

  const handleRefreshAllMetadata = async () => {
    setIsRefreshingMetadata(true);
    setMetadataMessage(null);
    try {
      const res = await fetch('/api/library/refresh-all-metadata', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMetadataMessage(`${data.updatedCount} título(s) atualizados com novas capas!`);
        if (onRefreshLibrary) {
          await onRefreshLibrary();
        }
      } else {
        setMetadataMessage(data.error || 'Falha ao buscar capas.');
      }
    } catch {
      setMetadataMessage('Erro de conexão ao buscar capas.');
    } finally {
      setIsRefreshingMetadata(false);
    }
  };

  const handleSetHwMode = async (mode: 'auto' | 'software' | 'off') => {
    setUpdatingHw(true);
    try {
      const res = await fetch('/api/system/hardware-acceleration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (data.success && data.hardwareAcceleration) {
        setStatus((prev) => prev ? { ...prev, hardwareAcceleration: data.hardwareAcceleration } : prev);
      }
    } catch (err) {
      console.error('Erro ao alternar aceleração por hardware:', err);
    } finally {
      setUpdatingHw(false);
    }
  };

  const handleInstallFfmpeg = async () => {
    setInstallingFfmpeg(true);
    setInstallMessage(null);
    try {
      const res = await fetch('/api/system/install-ffmpeg', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setInstallMessage('FFmpeg instalado com sucesso na pasta bin!');
        fetchStatus();
      } else {
        setInstallMessage(data.message || 'Falha ao instalar automaticamente.');
      }
    } catch {
      setInstallMessage('Erro ao comunicar com o servidor.');
    } finally {
      setInstallingFfmpeg(false);
    }
  };

  return (
    <div
      id="system-modal-backdrop"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="system-modal"
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
          <div className="w-10 h-10 rounded-lg bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Status do CineLocal</h2>
            <p className="text-xs text-neutral-400">Ambiente 100% offline, local e portátil</p>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-neutral-400">Consultando sistema...</div>
        ) : (
          <div className="space-y-4 text-xs">
            {/* Storage info */}
            <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 space-y-2">
              <div className="flex items-center justify-between text-neutral-200 font-semibold border-b border-neutral-800 pb-1.5">
                <span className="flex items-center space-x-1.5">
                  <FileJson className="w-4 h-4 text-amber-400" />
                  <span>Armazenamento de Dados</span>
                </span>
                <span className="text-emerald-400 text-[11px]">100% Offline (Sem Nuvem)</span>
              </div>
              <div className="space-y-1 text-neutral-400">
                <div>
                  <span className="text-neutral-500">Arquivo do Banco: </span>
                  <span className="font-mono text-neutral-300 text-[11px]">data/library.json</span>
                </div>
                <div>
                  <span className="text-neutral-500">Títulos cadastrados: </span>
                  <span className="text-white font-semibold">{status?.totalItems || 0}</span>
                </div>
              </div>
            </div>

            {/* FFmpeg / FFprobe info */}
            <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 space-y-2">
              <div className="flex items-center justify-between text-neutral-200 font-semibold border-b border-neutral-800 pb-1.5">
                <span className="flex items-center space-x-1.5">
                  <Terminal className="w-4 h-4 text-sky-400" />
                  <span>Motor de Mídia (FFmpeg & FFprobe)</span>
                </span>
              </div>

              <div className="space-y-1.5 text-neutral-400">
                <div className="flex items-center justify-between">
                  <span>FFmpeg:</span>
                  {status?.ffmpegFound ? (
                    <span className="flex items-center space-x-1 text-emerald-400 font-mono text-[11px] truncate max-w-[280px]">
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{status.ffmpegPath}</span>
                    </span>
                  ) : (
                    <span className="flex items-center space-x-1 text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Não encontrado</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span>FFprobe:</span>
                  {status?.ffprobeFound ? (
                    <span className="flex items-center space-x-1 text-emerald-400 font-mono text-[11px] truncate max-w-[280px]">
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{status.ffprobePath}</span>
                    </span>
                  ) : (
                    <span className="flex items-center space-x-1 text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Não encontrado</span>
                    </span>
                  )}
                </div>

                {!status?.ffmpegFound && (
                  <div className="mt-2 pt-2 border-t border-neutral-800 space-y-2">
                    <p className="text-[11px] text-neutral-400">
                      O FFmpeg é necessário para reproduzir arquivos <strong>.MKV</strong> e áudios com múltiplos canais.
                    </p>
                    <button
                      type="button"
                      onClick={handleInstallFfmpeg}
                      disabled={installingFfmpeg}
                      className="w-full flex items-center justify-center space-x-2 py-2 px-3 bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-700 text-white rounded-md font-medium text-xs transition-colors shadow"
                    >
                      {installingFfmpeg ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Baixando e instalando FFmpeg em bin/...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          <span>Instalar FFmpeg Automaticamente (1 Clique)</span>
                        </>
                      )}
                    </button>
                    {installMessage && (
                      <p className={`text-[11px] font-medium ${installMessage.includes('sucesso') ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {installMessage}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Hardware Acceleration (GPU) */}
            <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 space-y-2.5">
              <div className="flex items-center justify-between text-neutral-200 font-semibold border-b border-neutral-800 pb-1.5">
                <span className="flex items-center space-x-1.5">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Aceleração por Hardware (GPU / Transcoder)</span>
                </span>
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                  status?.hardwareAcceleration?.encoder
                    ? 'bg-emerald-950/60 border border-emerald-700/60 text-emerald-400 font-bold'
                    : 'bg-neutral-800 text-neutral-400'
                }`}>
                  {status?.hardwareAcceleration?.encoder
                    ? `GPU Ativa (${status.hardwareAcceleration.encoder})`
                    : status?.hardwareAcceleration?.mode === 'off'
                    ? 'Desativado'
                    : 'Software (CPU / libx264)'}
                </span>
              </div>

              <div className="space-y-2 text-neutral-400 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Encoder em uso:</span>
                  <span className="font-mono text-white text-[11px]">
                    {status?.hardwareAcceleration?.encoder || 'libx264 (Software CPU)'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Encoders GPU detectados:</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {status?.hardwareAcceleration?.availableEncoders && status.hardwareAcceleration.availableEncoders.length > 0 ? (
                      status.hardwareAcceleration.availableEncoders.map((enc) => (
                        <span key={enc} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-neutral-800 text-emerald-400 border border-emerald-900/50">
                          {enc}
                        </span>
                      ))
                    ) : (
                      <span className="text-neutral-500 text-[11px]">Nenhum codec GPU proprietário (usando CPU)</span>
                    )}
                  </div>
                </div>

                {/* Mode Selector */}
                <div className="pt-1">
                  <span className="text-[11px] text-neutral-400 block mb-1.5">Modo de Transcodificação:</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSetHwMode('auto')}
                      disabled={updatingHw}
                      className={`py-1.5 px-2 rounded text-[11px] font-medium transition cursor-pointer flex items-center justify-center gap-1 ${
                        status?.hardwareAcceleration?.mode === 'auto'
                          ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50 font-semibold'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      <Zap className="w-3 h-3 text-amber-400" />
                      Auto (GPU)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetHwMode('software')}
                      disabled={updatingHw}
                      className={`py-1.5 px-2 rounded text-[11px] font-medium transition cursor-pointer flex items-center justify-center gap-1 ${
                        status?.hardwareAcceleration?.mode === 'software'
                          ? 'bg-sky-600/30 text-sky-300 border border-sky-500/50 font-semibold'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      <Cpu className="w-3 h-3 text-sky-400" />
                      Software (CPU)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetHwMode('off')}
                      disabled={updatingHw}
                      className={`py-1.5 px-2 rounded text-[11px] font-medium transition cursor-pointer ${
                        status?.hardwareAcceleration?.mode === 'off'
                          ? 'bg-red-600/30 text-red-300 border border-red-500/50 font-semibold'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      Desativado
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* PWA & Mobile Access */}
            <div className="space-y-2">
              <MobileAccessBanner />
            </div>

            {/* TMDb Integration (Metadata & Covers) */}
            <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 space-y-2.5">
              <div className="flex items-center justify-between text-neutral-200 font-semibold border-b border-neutral-800 pb-1.5">
                <span className="flex items-center space-x-1.5">
                  <Film className="w-4 h-4 text-pink-400" />
                  <span>Capas e Metadados (TMDb)</span>
                </span>
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                  status?.tmdbConfigured
                    ? 'bg-emerald-950/60 border border-emerald-700/60 text-emerald-400 font-bold'
                    : 'bg-amber-950/60 border border-amber-700/60 text-amber-300 font-bold'
                }`}>
                  {status?.tmdbConfigured ? 'Conectado' : 'Não Configurado'}
                </span>
              </div>

              <p className="text-[11px] text-neutral-400 leading-relaxed">
                {status?.tmdbConfigured
                  ? 'A API do TMDb está ativa. Novas pastas adicionadas terão capas oficiais (posters), banners, sinopses e elenco baixados automaticamente.'
                  : 'O mecanismo automático de download de capas oficiais em alta definição, banners e sinopses necessita de uma chave gratuita do The Movie Database (TMDb). Sem essa chave, as capas automáticas da web ficam inativas.'}
              </p>

              {/* Form to insert/update TMDB key */}
              <form onSubmit={handleSaveTmdbKey} className="space-y-2 pt-1">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Key className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                    <input
                      type="text"
                      value={tmdbKeyInput}
                      onChange={(e) => setTmdbKeyInput(e.target.value)}
                      placeholder={status?.tmdbConfigured ? 'Substituir chave do TMDb (API Key)...' : 'Cole sua chave de API (v3) do TMDb...'}
                      className="w-full bg-black/60 border border-neutral-700 focus:border-pink-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 font-mono outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSavingTmdb || !tmdbKeyInput.trim()}
                    className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow shrink-0 flex items-center space-x-1"
                  >
                    {isSavingTmdb ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Salvar</span>}
                  </button>
                </div>
                {tmdbMessage && (
                  <p className="text-[11px] text-emerald-400 font-medium">{tmdbMessage}</p>
                )}
              </form>

              {/* Refresh all metadata button & Open Dedicated Modal */}
              <div className="pt-1 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-2">
                {status?.tmdbConfigured && (
                  <button
                    type="button"
                    onClick={handleRefreshAllMetadata}
                    disabled={isRefreshingMetadata}
                    className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-white/5 text-neutral-200 text-xs font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-50"
                    title="Baixar capas e sinopses do TMDb para todos os filmes e séries já escaneados"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-pink-400 ${isRefreshingMetadata ? 'animate-spin' : ''}`} />
                    <span>{isRefreshingMetadata ? 'Baixando capas...' : 'Buscar capas para todos os títulos'}</span>
                  </button>
                )}

                {onOpenTmdbModal && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenTmdbModal();
                    }}
                    className="px-3 py-1.5 rounded bg-pink-950/40 hover:bg-pink-900/50 border border-pink-700/50 text-pink-300 text-xs font-medium flex items-center space-x-1.5 transition-colors ml-auto"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Abrir Tela Completa do TMDb</span>
                  </button>
                )}

                {metadataMessage && (
                  <span className="text-[11px] text-emerald-400 font-medium w-full">{metadataMessage}</span>
                )}
              </div>

              {/* How to get TMDB Key Guide */}
              {!status?.tmdbConfigured && (
                <div className="p-2.5 rounded bg-amber-950/20 border border-amber-900/30 text-[11px] text-amber-200/90 space-y-1">
                  <div className="font-semibold text-amber-300 flex items-center justify-between">
                    <span>Como obter sua chave gratuita (2 minutos):</span>
                    <a
                      href="https://www.themoviedb.org/signup"
                      target="_blank"
                      rel="noreferrer"
                      className="text-pink-400 hover:underline flex items-center gap-0.5"
                    >
                      <span>themoviedb.org</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <ol className="list-decimal list-inside space-y-0.5 text-neutral-300">
                    <li>Crie uma conta gratuita em <strong className="text-white">themoviedb.org</strong>.</li>
                    <li>Vá em <strong>Configurações da Conta &gt; API</strong>.</li>
                    <li>Clique em <strong>Criar / Solicitar chave de API</strong> (tipo: Desenvolvedor).</li>
                    <li>Copie a <strong>Chave da API (v3 auth)</strong> e cole no campo acima ou no arquivo <code className="text-pink-300">.env</code> como <code className="text-pink-300">TMDB_API_KEY</code>.</li>
                  </ol>
                </div>
              )}
            </div>

            {/* OpenSubtitles Integration */}
            <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 space-y-2">
              <div className="flex items-center justify-between text-neutral-200 font-semibold border-b border-neutral-800 pb-1.5">
                <span className="flex items-center space-x-1.5">
                  <Subtitles className="w-4 h-4 text-amber-400" />
                  <span>Legendas Online (OpenSubtitles)</span>
                </span>
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                  status?.openSubtitlesAccountConfigured
                    ? 'bg-emerald-950/60 border border-emerald-700/60 text-emerald-400 font-bold'
                    : 'bg-neutral-800 text-neutral-400'
                }`}>
                  {status?.openSubtitlesAccountConfigured ? 'Conta Ativa' : 'API Básica'}
                </span>
              </div>
              <div className="space-y-1 text-neutral-400 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Usuário conectado:</span>
                  <span className="font-mono text-white text-[11px]">
                    {status?.openSubtitlesUsername || 'oevidente'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Busca e Download:</span>
                  <span className="text-emerald-400 text-[11px] flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Habilitado (Login Automático)
                  </span>
                </div>
              </div>
            </div>

            {/* Portable Pendrive guide */}
            <div className="p-3 rounded-lg bg-neutral-900/50 border border-neutral-800 text-neutral-400 space-y-1.5">
              <div className="font-semibold text-white">Como rodar no Windows:</div>
              <p className="text-[11px] leading-relaxed">
                1. Dê um duplo clique no arquivo <strong className="text-white">start.bat</strong> na pasta do CineLocal.
                <br />
                2. O app iniciará e abrirá automaticamente seu navegador em <strong className="text-white">http://localhost:3050</strong>.
                <br />
                3. Para instalar manualmente o FFmpeg, basta extrair o <strong>ffmpeg.exe</strong> e <strong>ffprobe.exe</strong> para dentro da pasta <strong>bin/</strong>.
              </p>
            </div>

            {/* Close button */}
            <div className="pt-2 flex items-center justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-lg bg-[#E50914] hover:bg-red-700 text-white font-bold transition-colors shadow-lg active:scale-95"
              >
                Fechar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
