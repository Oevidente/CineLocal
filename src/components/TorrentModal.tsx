import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Radio,
  Play,
  Trash2,
  Clock,
  HardDrive,
  Download,
  Users,
  Film,
  Tv,
  FileVideo,
  Loader2,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Search,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { TorrentStatus, TorrentHistoryItem, TorrentFileItem } from '../types';
import { formatTime, formatBytes } from '../utils';

interface TorrentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayTorrent: (status: TorrentStatus, selectedFileIndex: number) => void;
}

interface ParsedTorrentEpisode {
  file: TorrentFileItem;
  seasonNumber: number;
  episodeNumber: number;
  cleanTitle: string;
}

function parseEpisodeFromFileName(file: TorrentFileItem, fallbackIndex: number): ParsedTorrentEpisode {
  const normalizedPath = (file.path || file.name).replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/').filter(Boolean);
  const fileName = pathParts[pathParts.length - 1] || file.name;
  const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

  let pathSeason: number | undefined;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const sMatch = pathParts[i].match(/(?:temporada|season|s)\s*(\d{1,2})/i);
    if (sMatch) {
      const parsedS = parseInt(sMatch[1], 10);
      if (parsedS > 0 && parsedS < 100) {
        pathSeason = parsedS;
      }
    }
  }

  // S01E02 or S01.E02
  const sxxExx = nameWithoutExt.match(/[Ss](\d{1,2})[\.\s_-]*[Ee](\d{1,3})/);
  if (sxxExx) {
    const s = parseInt(sxxExx[1], 10);
    const e = parseInt(sxxExx[2], 10);
    let title = nameWithoutExt.substring(nameWithoutExt.indexOf(sxxExx[0]) + sxxExx[0].length);
    title = cleanRawTitle(title);
    return {
      file,
      seasonNumber: s || pathSeason || 1,
      episodeNumber: e,
      cleanTitle: title || `Episódio ${e}`,
    };
  }

  // 1x02
  const xMatch = nameWithoutExt.match(/(?:^|[\s._\-\[])(\d{1,2})[xX](\d{1,3})/);
  if (xMatch) {
    const s = parseInt(xMatch[1], 10);
    const e = parseInt(xMatch[2], 10);
    let title = nameWithoutExt.substring(nameWithoutExt.indexOf(xMatch[0]) + xMatch[0].length);
    title = cleanRawTitle(title);
    return {
      file,
      seasonNumber: s || pathSeason || 1,
      episodeNumber: e,
      cleanTitle: title || `Episódio ${e}`,
    };
  }

  // Temporada / Episodio
  const seasonEpMatch = nameWithoutExt.match(/(?:temporada|season)\s*(\d{1,2})[\s\S]*?(?:episodio|episódio|ep|episode)\s*(\d{1,3})/i);
  if (seasonEpMatch) {
    const s = parseInt(seasonEpMatch[1], 10);
    const e = parseInt(seasonEpMatch[2], 10);
    return {
      file,
      seasonNumber: s || pathSeason || 1,
      episodeNumber: e,
      cleanTitle: `Episódio ${e}`,
    };
  }

  // E02 or EP02
  const epOnly = nameWithoutExt.match(/(?:^|[\s._\-\[])(?:[Ee][Pp]?|episodio|episódio)\s*[-_.]?\s*(\d{1,3})/i);
  if (epOnly) {
    const e = parseInt(epOnly[1], 10);
    let title = nameWithoutExt.substring(nameWithoutExt.indexOf(epOnly[0]) + epOnly[0].length);
    title = cleanRawTitle(title);
    return {
      file,
      seasonNumber: pathSeason || 1,
      episodeNumber: e,
      cleanTitle: title || `Episódio ${e}`,
    };
  }

  // Anime - 02
  const animeMatch = nameWithoutExt.match(/(?:^|[\s._\-\]])-\s*(\d{1,3})(?:[\s._\-\[]|$)/);
  if (animeMatch) {
    const e = parseInt(animeMatch[1], 10);
    return {
      file,
      seasonNumber: pathSeason || 1,
      episodeNumber: e,
      cleanTitle: `Episódio ${e}`,
    };
  }

  // Leading number "01 - Pilot"
  const leadingNum = nameWithoutExt.match(/^(\d{1,3})[\s\.\-_]*(.*)/);
  if (leadingNum) {
    const e = parseInt(leadingNum[1], 10);
    const title = cleanRawTitle(leadingNum[2]);
    return {
      file,
      seasonNumber: pathSeason || 1,
      episodeNumber: e,
      cleanTitle: title || `Episódio ${e}`,
    };
  }

  return {
    file,
    seasonNumber: pathSeason || 1,
    episodeNumber: fallbackIndex,
    cleanTitle: cleanRawTitle(nameWithoutExt) || `Vídeo ${fallbackIndex}`,
  };
}

function cleanRawTitle(raw: string): string {
  return raw
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web-dl|webdl|hdtv|x264|x265|hevc|avc|aac|dts|ddp|ac3|yify|yts|eztv|tgx|rarbg|galaxytv|dual|dublado|legendado|multi|ita|eng|por)\b/gi, ' ')
    .replace(/[\._]/g, ' ')
    .replace(/^[-\s.:]+|[-\s.:]+$/g, '')
    .trim();
}

export const TorrentModal: React.FC<TorrentModalProps> = ({
  isOpen,
  onClose,
  onPlayTorrent,
}) => {
  const [magnetInput, setMagnetInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<TorrentStatus | null>(null);
  const [history, setHistory] = useState<TorrentHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [selectedSeasonFilter, setSelectedSeasonFilter] = useState<number | 'all'>('all');
  const [episodeSearchQuery, setEpisodeSearchQuery] = useState<string>('');

  // Fetch history when modal opens
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/torrent/history');
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error('Erro ao buscar histórico de torrents:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
      setError(null);
    } else {
      setStatus(null);
      setMagnetInput('');
      setLoading(false);
      setEpisodeSearchQuery('');
      setSelectedSeasonFilter('all');
    }
  }, [isOpen]);

  // Poll status when a torrent is actively connecting or loading metadata
  useEffect(() => {
    if (!status || (status.state !== 'connecting' && status.state !== 'metadata')) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/torrent/status/${status.infoHash}`);
        if (res.ok) {
          const updated: TorrentStatus = await res.json();
          setStatus(updated);
          if (updated.state === 'ready' || updated.state === 'downloading') {
            if (updated.files.length > 0) {
              const videoFiles = updated.files.filter((f) => f.isVideo);
              if (videoFiles.length > 0 && selectedFileIdx === 0) {
                setSelectedFileIdx(updated.selectedFileIndex ?? videoFiles[0].index);
              }
            }
          }
        }
      } catch {}
    }, 1200);

    return () => clearInterval(interval);
  }, [status?.infoHash, status?.state, selectedFileIdx]);

  const handleStartTorrent = async (magnetUri: string) => {
    if (!magnetUri.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/torrent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnetUri: magnetUri.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Falha ao iniciar torrent');
      }

      const initialStatus: TorrentStatus = await res.json();
      setStatus(initialStatus);

      if (initialStatus.files && initialStatus.files.length > 0) {
        const videoFiles = initialStatus.files.filter((f) => f.isVideo);
        if (videoFiles.length > 0) {
          setSelectedFileIdx(initialStatus.selectedFileIndex ?? videoFiles[0].index);
        }
      }

      await fetchHistory();
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar ao torrent.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTorrentKind = async (infoHash: string, currentKind: 'movie' | 'series', e: React.MouseEvent) => {
    e.stopPropagation();
    const nextKind = currentKind === 'series' ? 'movie' : 'series';
    try {
      const res = await fetch(`/api/media/${infoHash}/kind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: nextKind }),
      });
      if (res.ok) {
        setHistory((prev) =>
          prev.map((h) => (h.infoHash.toLowerCase() === infoHash.toLowerCase() ? { ...h, kind: nextKind } : h))
        );
      }
    } catch (err) {
      console.error('Erro ao alternar tipo de torrent:', err);
    }
  };

  const handleDeleteHistory = async (infoHash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/torrent/history/${infoHash}`, { method: 'DELETE' });
      await fetch(`/api/torrent/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ infoHash, deleteCache: true }),
      });
      setHistory((prev) => prev.filter((item) => item.infoHash !== infoHash));
      if (status && status.infoHash === infoHash) {
        setStatus(null);
      }
    } catch (err) {
      console.error('Erro ao deletar torrent do histórico:', err);
    }
  };

  const handleLaunchPlayer = (fileIdx?: number) => {
    if (!status) return;
    const targetIdx = typeof fileIdx === 'number' ? fileIdx : selectedFileIdx;
    onPlayTorrent(status, targetIdx);
    onClose();
  };

  const videoFiles = useMemo(() => {
    const raw = status?.files?.filter((f) => f.isVideo) || [];
    if (raw.length <= 1) return raw;
    const maxLen = raw.reduce((acc, f) => Math.max(acc, f.length || 0), 0);
    const nonSamples = raw.filter((f) => {
      const norm = (f.path || f.name).toLowerCase().replace(/\\/g, '/');
      if (/(?:^|[\/._\-\[])(?:sample|trailer|featurette|extras?|bonus|promo|preview)(?:[\/._\-\]]|\.mp4|\.mkv|\.avi)/i.test(norm)) {
        return false;
      }
      if (f.length < 80 * 1024 * 1024 && maxLen > 300 * 1024 * 1024) {
        return false;
      }
      return true;
    });
    return nonSamples.length > 0 ? nonSamples : raw;
  }, [status?.files]);

  // Parse files into episodes
  const parsedEpisodes: ParsedTorrentEpisode[] = useMemo(() => {
    return videoFiles.map((file, idx) => parseEpisodeFromFileName(file, idx + 1));
  }, [videoFiles]);

  const isSeries = useMemo(() => {
    if (videoFiles.length > 1) return true;
    if (status?.name && /[Ss]\d{1,2}|Season\s*\d+|Temporada\s*\d+|\d{1,2}x\d{1,3}|[Ee][Pp]?\d{1,4}/i.test(status.name)) return true;
    if (parsedEpisodes.some((e) => e.seasonNumber > 0 && (e.file.name.match(/[Ss]\d{1,2}|Season|Temporada|\d{1,2}x\d{1,3}|[Ee][Pp]?\d{1,4}/i)))) return true;
    return false;
  }, [videoFiles.length, status?.name, parsedEpisodes]);

  // Unique seasons list
  const availableSeasons = useMemo(() => {
    const set = new Set<number>();
    parsedEpisodes.forEach((e) => set.add(e.seasonNumber));
    return Array.from(set).sort((a, b) => a - b);
  }, [parsedEpisodes]);

  // Filtered episodes based on season and search
  const filteredEpisodes = useMemo(() => {
    let list = parsedEpisodes;
    if (selectedSeasonFilter !== 'all') {
      list = list.filter((e) => e.seasonNumber === selectedSeasonFilter);
    }
    if (episodeSearchQuery.trim()) {
      const q = episodeSearchQuery.toLowerCase().trim();
      list = list.filter(
        (e) =>
          e.cleanTitle.toLowerCase().includes(q) ||
          e.file.name.toLowerCase().includes(q) ||
          `e${e.episodeNumber}`.includes(q) ||
          `ep${e.episodeNumber}`.includes(q) ||
          `t${e.seasonNumber}`.includes(q)
      );
    }
    return list;
  }, [parsedEpisodes, selectedSeasonFilter, episodeSearchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-amber-600 flex items-center justify-center shadow-lg shadow-red-950/40">
              <Radio className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">Player de Séries & Filmes Torrent</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-600/30 text-red-400 border border-red-500/30">
                  P2P Stream
                </span>
              </div>
              <p className="text-xs text-zinc-400">Transmissão instantânea direta via streaming com suporte completo a temporadas e episódios</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Input Magnet Box */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              Cole o link Magnet ou Hash da Série / Filme
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={magnetInput}
                onChange={(e) => setMagnetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleStartTorrent(magnetInput);
                }}
                placeholder="magnet:?xt=urn:btih:..."
                className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-700/80 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
              <button
                onClick={() => handleStartTorrent(magnetInput)}
                disabled={loading || !magnetInput.trim()}
                className="px-5 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl flex items-center gap-2 transition shadow-md shadow-red-900/20 cursor-pointer"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                <span>Abrir</span>
              </button>
            </div>
            {error && (
              <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-xl text-xs text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Active Torrent Loading / Ready Card */}
          {status && (
            <div className="p-5 bg-zinc-900/90 border border-zinc-700/70 rounded-2xl space-y-4 shadow-xl">
              {/* Torrent header info */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        status.state === 'ready' || status.state === 'downloading'
                          ? 'bg-emerald-500 animate-pulse'
                          : status.state === 'error'
                          ? 'bg-red-500'
                          : 'bg-amber-500 animate-ping'
                      }`}
                    />
                    {isSeries ? (
                      <button
                        onClick={(e) => handleToggleTorrentKind(status.infoHash, 'series', e)}
                        className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/40 flex items-center gap-1 cursor-pointer transition"
                        title="Clique para alternar para Filme"
                      >
                        <Tv className="w-3 h-3" /> Série de TV
                        <span className="text-[9px] text-amber-400 font-normal ml-0.5">(Alternar)</span>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => handleToggleTorrentKind(status.infoHash, 'movie', e)}
                        className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/40 flex items-center gap-1 cursor-pointer transition"
                        title="Clique para alternar para Série"
                      >
                        <Film className="w-3 h-3" /> Filme
                        <span className="text-[9px] text-sky-400 font-normal ml-0.5">(Alternar)</span>
                      </button>
                    )}
                    <h3 className="text-sm sm:text-base font-bold text-white line-clamp-1">{status.name}</h3>
                  </div>

                  <p className="text-xs text-zinc-400">
                    {status.state === 'connecting' && 'Buscando peers na rede BitTorrent...'}
                    {status.state === 'metadata' && 'Baixando metadados do torrent...'}
                    {(status.state === 'ready' || status.state === 'downloading') && (
                      isSeries
                        ? `Série identificada com ${videoFiles.length} episódios em ${availableSeasons.length || 1} temporada(s).`
                        : 'Pronto para reproduzir!'
                    )}
                    {status.state === 'error' && (status.errorMessage || 'Erro ao carregar torrent')}
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs self-start">
                  <div className="flex items-center gap-1 text-zinc-300 bg-zinc-800/80 px-2.5 py-1.5 rounded-lg border border-zinc-700/60">
                    <Users className="w-3.5 h-3.5 text-sky-400" />
                    <span>{status.peers} peers</span>
                  </div>
                  {status.downloadSpeed > 0 && (
                    <div className="flex items-center gap-1 text-zinc-300 bg-zinc-800/80 px-2.5 py-1.5 rounded-lg border border-zinc-700/60">
                      <Download className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{formatBytes(status.downloadSpeed)}/s</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-zinc-400 font-medium">
                  <span>{formatBytes(status.downloadedBytes)} baixados ({status.progress}%)</span>
                  <span>Total: {formatBytes(status.totalBytes)}</span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-red-600 to-amber-500 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${Math.max(status.progress, 1)}%` }}
                  />
                </div>
              </div>

              {/* Series Episodes Browser / Selector */}
              {isSeries && videoFiles.length > 0 && (
                <div className="pt-3 border-t border-zinc-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-red-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Episódios da Série ({videoFiles.length})
                      </h4>
                    </div>

                    {/* Search inside series episodes */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={episodeSearchQuery}
                        onChange={(e) => setEpisodeSearchQuery(e.target.value)}
                        placeholder="Filtrar episódio..."
                        className="pl-8 pr-3 py-1 bg-zinc-800/80 border border-zinc-700/80 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 w-full sm:w-44"
                      />
                    </div>
                  </div>

                  {/* Season Filter Tabs */}
                  {availableSeasons.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      <button
                        onClick={() => setSelectedSeasonFilter('all')}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                          selectedSeasonFilter === 'all'
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'bg-zinc-800/70 text-zinc-400 hover:text-white hover:bg-zinc-800'
                        }`}
                      >
                        Todas as Temporadas
                      </button>
                      {availableSeasons.map((seasonNum) => (
                        <button
                          key={seasonNum}
                          onClick={() => setSelectedSeasonFilter(seasonNum)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                            selectedSeasonFilter === seasonNum
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'bg-zinc-800/70 text-zinc-400 hover:text-white hover:bg-zinc-800'
                          }`}
                        >
                          Temporada {seasonNum}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Episode List Cards */}
                  <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                    {filteredEpisodes.map((ep) => {
                      const isSelected = selectedFileIdx === ep.file.index;
                      return (
                        <div
                          key={ep.file.index}
                          onClick={() => setSelectedFileIdx(ep.file.index)}
                          className={`w-full p-2.5 rounded-xl text-xs flex items-center justify-between gap-3 transition cursor-pointer border ${
                            isSelected
                              ? 'bg-red-950/60 border-red-700/80 text-white shadow-md'
                              : 'bg-zinc-800/50 hover:bg-zinc-800/90 border-transparent text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate min-w-0">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold flex-shrink-0 ${
                              isSelected ? 'bg-red-600 text-white' : 'bg-zinc-700/80 text-zinc-300'
                            }`}>
                              T{ep.seasonNumber < 10 ? `0${ep.seasonNumber}` : ep.seasonNumber}:E{ep.episodeNumber < 10 ? `0${ep.episodeNumber}` : ep.episodeNumber}
                            </span>
                            <div className="truncate">
                              <p className={`font-semibold truncate ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                                {ep.cleanTitle}
                              </p>
                              <p className="text-[10px] text-zinc-400 truncate opacity-80">
                                {ep.file.name}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[11px] text-zinc-400 font-mono">
                              {formatBytes(ep.file.length)}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleLaunchPlayer(ep.file.index);
                              }}
                              className={`p-1.5 rounded-lg transition ${
                                isSelected
                                  ? 'bg-red-600 text-white hover:bg-red-500'
                                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'
                              }`}
                              title="Assistir este episódio agora"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Single Video File (Movie) Display */}
              {!isSeries && videoFiles.length === 1 && (
                <div className="p-2.5 bg-zinc-800/60 rounded-xl flex items-center justify-between text-xs text-zinc-300 border border-zinc-700/50">
                  <div className="flex items-center gap-2 truncate">
                    <FileVideo className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className="truncate">{videoFiles[0].name}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 ml-2 flex-shrink-0">
                    {formatBytes(videoFiles[0].length)}
                  </span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => handleLaunchPlayer()}
                  disabled={status.state === 'error' || (videoFiles.length === 0 && status.state !== 'ready')}
                  className="w-full py-3.5 bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-red-950/40 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {isSeries
                      ? `Assistir Episódio Selecionado (${parsedEpisodes.find((e) => e.file.index === selectedFileIdx)?.cleanTitle || 'Play'})`
                      : 'Assistir Filme no CineLocal'}
                  </span>
                </button>
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Salvo automaticamente na sua Biblioteca e no catálogo principal</span>
                </div>
              </div>
            </div>
          )}

          {/* History List */}
          {history.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Séries & Torrents Salvos
                </h3>
                <span className="text-[11px] text-zinc-500">Disponíveis no catálogo</span>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {history.map((item) => {
                  const isHistSeries = item.kind === 'series' || (!item.kind && /[Ss]\d{1,2}|Season\s*\d+|Temporada\s*\d+/i.test(item.name));
                  return (
                    <div
                      key={item.infoHash}
                      onClick={() => handleStartTorrent(item.magnetUri)}
                      className="p-3 bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl flex items-center justify-between gap-3 cursor-pointer group transition"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-red-400 transition flex-shrink-0">
                          {isHistSeries ? <Tv className="w-4 h-4 text-amber-400" /> : <Film className="w-4 h-4 text-sky-400" />}
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-medium text-white truncate group-hover:text-red-300 transition">
                            {item.name}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-0.5">
                            <span className="text-emerald-400/80 font-medium flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" /> Na Biblioteca
                            </span>
                            <button
                              onClick={(e) => handleToggleTorrentKind(item.infoHash, isHistSeries ? 'series' : 'movie', e)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase transition flex items-center gap-1 cursor-pointer border ${
                                isHistSeries
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                                  : 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30'
                              }`}
                              title="Clique para alternar entre Filme e Série"
                            >
                              {isHistSeries ? <Tv className="w-2.5 h-2.5" /> : <Film className="w-2.5 h-2.5" />}
                              <span>{isHistSeries ? 'Série' : 'Filme'}</span>
                            </button>
                            {item.totalBytes ? <span>• {formatBytes(item.totalBytes)}</span> : null}
                            {item.progressSeconds && item.progressSeconds > 10 ? (
                              <span className="text-amber-400">
                                • Parou em: {formatTime(item.progressSeconds)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={(e) => handleDeleteHistory(item.infoHash, e)}
                          title="Remover do histórico e limpar cache"
                          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <div className="p-1.5 rounded-lg bg-zinc-800 group-hover:bg-red-600 text-zinc-400 group-hover:text-white transition">
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
