import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Tv,
  Radio,
  Search,
  Star,
  Play,
  RefreshCw,
  Filter,
  Grid,
  List as ListIcon,
  ChevronRight,
  ChevronLeft,
  Globe,
  SlidersHorizontal,
  Upload,
  Link as LinkIcon,
  Layers,
  Sparkles,
  Check,
  AlertCircle,
  Film,
  Zap,
} from 'lucide-react';
import { IptvChannel, IptvPreset, IptvPlaylistSummary, ChannelStatusInfo } from '../types';

interface ChannelsPageProps {
  onPlayChannel: (channel: IptvChannel, allChannels: IptvChannel[]) => void;
  favorites: string[];
  onToggleFavorite: (channelId: string) => void;
}

const DEFAULT_PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u';

export const ChannelsPage: React.FC<ChannelsPageProps> = ({
  onPlayChannel,
  favorites,
  onToggleFavorite,
}) => {
  const [playlistUrl, setPlaylistUrl] = useState<string>(() => {
    return localStorage.getItem('cine_iptv_playlist_url') || DEFAULT_PLAYLIST_URL;
  });
  const [playlistData, setPlaylistData] = useState<IptvPlaylistSummary | null>(null);
  const [presets, setPresets] = useState<IptvPreset[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Channel Status Map (online / offline)
  const [statusMap, setStatusMap] = useState<Record<string, ChannelStatusInfo>>({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [isCheckingBatch, setIsCheckingBatch] = useState<boolean>(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');
  const [selectedQuality, setSelectedQuality] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showCustomModal, setShowCustomModal] = useState<boolean>(false);
  const [customUrlInput, setCustomUrlInput] = useState<string>('');

  const ITEMS_PER_PAGE = 48;

  // Load presets & status map
  useEffect(() => {
    fetch('/api/iptv/presets')
      .then((res) => res.json())
      .then((data) => setPresets(data))
      .catch((err) => console.error('Erro ao carregar presets IPTV:', err));

    fetch('/api/iptv/statuses')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === 'object') {
          setStatusMap(data);
        }
      })
      .catch((err) => console.error('Erro ao carregar status dos canais:', err));
  }, []);

  // Fetch playlist
  const loadPlaylist = useCallback(async (url: string, forceRefresh = false) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/iptv/playlist?url=${encodeURIComponent(url)}${forceRefresh ? '&refresh=true' : ''}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Falha ao carregar lista de canais IPTV');
      }
      const data: IptvPlaylistSummary = await res.json();
      setPlaylistData(data);
      setCurrentPage(1);
    } catch (err: any) {
      console.error('Erro ao buscar canais:', err);
      setErrorMsg(err.message || 'Não foi possível baixar os canais. Verifique a URL ou conexão.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlaylist(playlistUrl);
  }, [playlistUrl, loadPlaylist]);

  const handleSelectPreset = (url: string) => {
    setPlaylistUrl(url);
    localStorage.setItem('cine_iptv_playlist_url', url);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrlInput.trim()) return;
    setPlaylistUrl(customUrlInput.trim());
    localStorage.setItem('cine_iptv_playlist_url', customUrlInput.trim());
    setShowCustomModal(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const text = await file.text();
      const res = await fetch('/api/iptv/parse-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, name: file.name }),
      });
      if (!res.ok) throw new Error('Falha ao processar arquivo M3U');
      const data = await res.json();
      setPlaylistData(data);
      setPlaylistUrl(`Arquivo Local: ${file.name}`);
      setShowCustomModal(false);
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter channels
  const filteredChannels = useMemo(() => {
    if (!playlistData) return [];

    return playlistData.channels.filter((ch) => {
      // Availability filter
      const chStatus = statusMap[ch.url]?.status;
      if (statusFilter === 'online' && chStatus === 'offline') return false;
      if (statusFilter === 'offline' && chStatus !== 'offline') return false;

      // Favorites filter
      if (selectedCategory === 'favorites') {
        if (!favorites.includes(ch.id)) return false;
      } else if (selectedCategory !== 'all') {
        if (ch.group.toLowerCase() !== selectedCategory.toLowerCase()) return false;
      }

      // Country filter
      if (selectedCountry !== 'all') {
        if (ch.country?.toUpperCase() !== selectedCountry.toUpperCase()) return false;
      }

      // Quality filter
      if (selectedQuality !== 'all') {
        if (!ch.resolution || !ch.resolution.includes(selectedQuality)) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = ch.name.toLowerCase().includes(q);
        const matchGroup = ch.group.toLowerCase().includes(q);
        const matchCountry = ch.country?.toLowerCase().includes(q);
        if (!matchName && !matchGroup && !matchCountry) return false;
      }

      return true;
    });
  }, [playlistData, selectedCategory, selectedCountry, selectedQuality, searchQuery, favorites, statusMap, statusFilter]);

  // Favorite channels list for top shelf
  const favoriteChannelsList = useMemo(() => {
    if (!playlistData) return [];
    return playlistData.channels.filter((c) => favorites.includes(c.id));
  }, [playlistData, favorites]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredChannels.length / ITEMS_PER_PAGE);
  const paginatedChannels = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredChannels.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredChannels, currentPage]);

  // Batch prober for channels on the current page
  const handleCheckCurrentPageStatus = async () => {
    if (isCheckingBatch || paginatedChannels.length === 0) return;
    setIsCheckingBatch(true);
    try {
      const urls = paginatedChannels.map((c) => c.url);
      const res = await fetch('/api/iptv/check-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.results) {
          setStatusMap((prev) => ({ ...prev, ...data.results }));
        }
      }
    } catch (err) {
      console.error('Erro ao verificar status dos canais:', err);
    } finally {
      setIsCheckingBatch(false);
    }
  };

  // Main popular categories to show as quick chips
  const popularCategoryChips = [
    { id: 'all', label: 'Todos os Canais', icon: Tv },
    { id: 'favorites', label: `⭐ Favoritos (${favorites.length})`, icon: Star },
    { id: 'General', label: 'Geral', icon: Radio },
    { id: 'News', label: 'Notícias', icon: Radio },
    { id: 'Movies', label: 'Filmes', icon: Film },
    { id: 'Sports', label: 'Esportes', icon: Zap },
    { id: 'Music', label: 'Música', icon: Sparkles },
    { id: 'Kids', label: 'Infantil', icon: Tv },
    { id: 'Documentary', label: 'Documentários', icon: Globe },
    { id: 'Entertainment', label: 'Entretenimento', icon: Tv },
  ];

  return (
    <div className="min-h-screen bg-[#141414] text-white pt-24 sm:pt-28 pb-28 sm:pb-20 px-3 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Hero Header */}
      <div className="relative rounded-2xl bg-gradient-to-r from-red-950/50 via-zinc-900 to-black border border-red-900/30 p-6 sm:p-8 mb-8 overflow-hidden shadow-2xl">
        <div className="absolute -right-10 -bottom-10 opacity-10 pointer-events-none">
          <Tv className="w-80 h-80 text-red-500" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center space-x-2.5 mb-2">
              <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-red-600/30 border border-red-500/40 text-red-400 text-xs font-bold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <span>IPTV Ao Vivo</span>
              </span>
              <span className="text-neutral-400 text-xs font-mono">
                {playlistData ? `${playlistData.totalChannels.toLocaleString()} canais carregados` : 'Carregando...'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white mb-2">
              TV Ao Vivo & Canais de Streaming
            </h1>
            <p className="text-neutral-300 text-sm max-w-2xl">
              Assista canais abertos e temáticos de todo o mundo via IPTV. Compatível com HLS, reprodução direta ou proxy anti-CORS.
            </p>
          </div>

          {/* Playlist selector / preset dropdown */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={playlistUrl.startsWith('http') ? playlistUrl : 'custom'}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setShowCustomModal(true);
                  } else {
                    handleSelectPreset(e.target.value);
                  }
                }}
                className="bg-neutral-900/90 border border-neutral-700 hover:border-neutral-500 text-white text-xs sm:text-sm rounded-lg px-3 py-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-[#E50914] cursor-pointer"
              >
                <optgroup label="Listas Prontas (iptv-org)">
                  {presets.map((p) => (
                    <option key={p.url} value={p.url}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Personalizado">
                  <option value="custom">➕ Inserir outro Link M3U...</option>
                </optgroup>
              </select>
            </div>

            <button
              onClick={() => loadPlaylist(playlistUrl, true)}
              disabled={isLoading}
              className="p-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg transition-colors border border-neutral-700 cursor-pointer"
              title="Atualizar lista de canais"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-red-500' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Top Shelf: Favorited Channels (if any) */}
      {favoriteChannelsList.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center space-x-2 mb-4">
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
            <h2 className="text-lg font-bold text-white tracking-wide">Meus Canais Favoritos</h2>
            <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-mono font-bold">
              {favoriteChannelsList.length}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {favoriteChannelsList.map((ch) => (
              <div
                key={`fav-${ch.id}`}
                onClick={() => onPlayChannel(ch, favoriteChannelsList)}
                className="group relative bg-zinc-900/80 hover:bg-zinc-800/90 border border-amber-500/30 hover:border-amber-400/80 rounded-xl p-3 flex flex-col items-center justify-between text-center transition-all duration-300 hover:scale-[1.03] hover:shadow-xl hover:shadow-amber-950/20 cursor-pointer"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(ch.id);
                  }}
                  className="absolute top-2 right-2 p-1 text-amber-400 hover:text-neutral-400 transition-colors"
                  title="Remover dos favoritos"
                >
                  <Star className="w-4 h-4 fill-amber-400" />
                </button>

                <div className="w-16 h-16 sm:w-20 sm:h-20 my-2 flex items-center justify-center bg-black/50 rounded-xl p-2 border border-white/5">
                  {ch.logo ? (
                    <img
                      src={ch.logo}
                      alt={ch.name}
                      className="w-full h-full object-contain filter drop-shadow"
                      onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                    />
                  ) : (
                    <Tv className="w-8 h-8 text-neutral-500" />
                  )}
                </div>

                <div className="w-full">
                  <h3 className="text-xs sm:text-sm font-bold text-white truncate mb-1">{ch.name}</h3>
                  <div className="flex items-center justify-center space-x-1 text-[10px] text-neutral-400">
                    <span className="truncate max-w-[90px]">{ch.group}</span>
                    {ch.resolution && <span className="text-emerald-400 font-mono font-bold">{ch.resolution}</span>}
                  </div>
                </div>

                {/* Hover Play Icon */}
                <div className="absolute inset-0 bg-black/60 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-xs">
                  <div className="w-11 h-11 rounded-full bg-[#E50914] text-white flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category Chips Bar */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-3 mb-6 scrollbar-thin scrollbar-thumb-neutral-700">
        {popularCategoryChips.map((chip) => {
          const Icon = chip.icon;
          const isSelected = selectedCategory === chip.id;
          return (
            <button
              key={chip.id}
              onClick={() => {
                setSelectedCategory(chip.id);
                setCurrentPage(1);
              }}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                isSelected
                  ? 'bg-[#E50914] text-white shadow-md shadow-red-950/40'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-neutral-300 hover:text-white border border-neutral-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{chip.label}</span>
            </button>
          );
        })}
      </div>

      {/* Search, Country & View Filter Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-zinc-900/60 border border-neutral-800 rounded-xl p-4 mb-6">
        {/* Search Bar */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar canal por nome, categoria ou país..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-black/60 border border-neutral-700 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#E50914]"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(1);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Dropdowns: Category, Country, Quality */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Full Categories Dropdown */}
          {playlistData && playlistData.categories.length > 0 && (
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-black/60 border border-neutral-700 text-neutral-300 rounded-lg px-2.5 py-2 focus:outline-none focus:border-[#E50914]"
            >
              <option value="all">Todas as Categorias ({playlistData.categories.length})</option>
              <option value="favorites">⭐ Favoritos</option>
              {playlistData.categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          )}

          {/* Country Dropdown */}
          {playlistData && playlistData.countries.length > 0 && (
            <select
              value={selectedCountry}
              onChange={(e) => {
                setSelectedCountry(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-black/60 border border-neutral-700 text-neutral-300 rounded-lg px-2.5 py-2 focus:outline-none focus:border-[#E50914]"
            >
              <option value="all">Todos os Países</option>
              <option value="BR">Brasil 🇧🇷 (BR)</option>
              <option value="PT">Portugal 🇵🇹 (PT)</option>
              <option value="US">Estados Unidos 🇺🇸 (US)</option>
              <option value="ES">Espanha 🇪🇸 (ES)</option>
              <option value="FR">França 🇫🇷 (FR)</option>
              <option value="AR">Argentina 🇦🇷 (AR)</option>
              <option value="IT">Itália 🇮🇹 (IT)</option>
              <option value="UK">Reino Unido 🇬🇧 (UK)</option>
              {playlistData.countries
                .filter((c) => !['BR', 'PT', 'US', 'ES', 'FR', 'AR', 'IT', 'UK'].includes(c))
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          )}

          {/* Quality Dropdown */}
          <select
            value={selectedQuality}
            onChange={(e) => {
              setSelectedQuality(e.target.value);
              setCurrentPage(1);
            }}
            className="bg-black/60 border border-neutral-700 text-neutral-300 rounded-lg px-2.5 py-2 focus:outline-none focus:border-[#E50914]"
          >
            <option value="all">Qualquer Qualidade</option>
            <option value="1080P">1080p / Full HD</option>
            <option value="720P">720p / HD</option>
            <option value="4K">4K Ultra HD</option>
          </select>

          {/* Availability Status Filter Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            className="bg-black/60 border border-neutral-700 text-neutral-300 rounded-lg px-2.5 py-2 focus:outline-none focus:border-[#E50914]"
          >
            <option value="all">Status: Todos</option>
            <option value="online">🟢 Apenas Disponíveis (Online)</option>
            <option value="offline">🔴 Apenas Fora do Ar (Indisponíveis)</option>
          </select>

          {/* Test Visible Channels Button */}
          <button
            onClick={handleCheckCurrentPageStatus}
            disabled={isCheckingBatch || paginatedChannels.length === 0}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-neutral-700 text-neutral-200 hover:text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="Testar sinal dos canais visíveis nesta página"
          >
            {isCheckingBatch ? (
              <RefreshCw className="w-3.5 h-3.5 text-red-400 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>{isCheckingBatch ? 'Testando sinais...' : 'Testar Sinais'}</span>
          </button>

          {/* View Mode */}
          <div className="flex items-center bg-black/60 border border-neutral-700 rounded-lg p-0.5 ml-auto">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-[#E50914] text-white' : 'text-neutral-400 hover:text-white'}`}
              title="Grade"
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-[#E50914] text-white' : 'text-neutral-400 hover:text-white'}`}
              title="Lista"
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-12 h-12 border-4 border-[#E50914] border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-white font-semibold text-lg">Carregando canais IPTV...</p>
          <p className="text-neutral-400 text-xs mt-1">Baixando e indexando a lista de transmissão</p>
        </div>
      )}

      {/* Error Message */}
      {errorMsg && !isLoading && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-6 text-center my-8 max-w-lg mx-auto">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">Erro ao Carregar Canais</h3>
          <p className="text-neutral-300 text-sm mb-4">{errorMsg}</p>
          <button
            onClick={() => loadPlaylist(playlistUrl, true)}
            className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] text-white rounded-lg text-xs font-bold transition-all shadow-md cursor-pointer"
          >
            Tentar Novamente
          </button>
        </div>
      )}

      {/* Channel Grid / List */}
      {!isLoading && !errorMsg && (
        <>
          {filteredChannels.length === 0 ? (
            <div className="bg-zinc-900/40 border border-neutral-800 rounded-xl p-12 text-center my-8">
              <Tv className="w-12 h-12 text-neutral-600 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">Nenhum canal encontrado</h3>
              <p className="text-neutral-400 text-xs mb-4">Tente alterar os filtros ou o termo de busca.</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                  setSelectedCountry('all');
                  setSelectedQuality('all');
                }}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-semibold"
              >
                Limpar Filtros
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
              {paginatedChannels.map((ch) => {
                const isFav = favorites.includes(ch.id);
                const statusInfo = statusMap[ch.url];
                const isOffline = statusInfo?.status === 'offline';
                const isOnline = statusInfo?.status === 'online';

                return (
                  <div
                    key={ch.id}
                    onClick={() => onPlayChannel(ch, filteredChannels)}
                    className={`group relative bg-zinc-900/90 hover:bg-zinc-800 border rounded-xl p-3 flex flex-col items-center justify-between text-center transition-all duration-300 hover:scale-[1.03] hover:shadow-xl cursor-pointer ${
                      isOffline
                        ? 'opacity-65 hover:opacity-100 border-red-900/40 bg-zinc-950/70 hover:shadow-red-950/30'
                        : isOnline
                        ? 'border-emerald-800/40 hover:border-emerald-600/70 hover:shadow-emerald-950/20'
                        : 'border-neutral-800 hover:border-red-600/60 hover:shadow-red-950/20'
                    }`}
                  >
                    {/* Status Badge (Online / Offline) */}
                    {isOffline && (
                      <span
                        className="absolute top-2 left-2 flex items-center space-x-1 px-1.5 py-0.5 rounded bg-red-950/90 border border-red-700/80 text-red-300 text-[9px] font-extrabold z-10 shadow tracking-tight"
                        title="Sinal offline ou indisponível no momento"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                        <span>Indisponível</span>
                      </span>
                    )}
                    {isOnline && (
                      <span
                        className="absolute top-2 left-2 flex items-center space-x-1 px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-700/80 text-emerald-300 text-[9px] font-extrabold z-10 shadow tracking-tight"
                        title="Sinal testado e ativo"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span>Online</span>
                      </span>
                    )}

                    {/* Favorite Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(ch.id);
                      }}
                      className="absolute top-2 right-2 p-1 text-neutral-500 hover:text-amber-400 transition-colors z-10"
                      title={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                    >
                      <Star className={`w-4 h-4 ${isFav ? 'text-amber-400 fill-amber-400' : ''}`} />
                    </button>

                    {/* Logo */}
                    <div className="w-16 h-16 sm:w-20 sm:h-20 my-2 flex items-center justify-center bg-black/60 rounded-xl p-2 border border-white/5">
                      {ch.logo ? (
                        <img
                          src={ch.logo}
                          alt={ch.name}
                          className="w-full h-full object-contain filter drop-shadow"
                          onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                        />
                      ) : (
                        <Tv className="w-8 h-8 text-neutral-500" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="w-full">
                      <h3 className="text-xs sm:text-sm font-bold text-white truncate mb-1">{ch.name}</h3>
                      <div className="flex items-center justify-center space-x-1 text-[10px] text-neutral-400">
                        <span className="truncate max-w-[80px] bg-white/5 px-1.5 py-0.5 rounded">{ch.group}</span>
                        {ch.country && <span>{ch.country}</span>}
                        {ch.resolution && (
                          <span className="text-red-400 font-mono font-bold">{ch.resolution}</span>
                        )}
                      </div>
                    </div>

                    {/* Hover Play Button */}
                    <div className="absolute inset-0 bg-black/60 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-xs">
                      <div className={`w-11 h-11 rounded-full text-white flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform ${isOffline ? 'bg-zinc-700' : 'bg-[#E50914]'}`}>
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-zinc-900/80 border border-neutral-800 rounded-xl divide-y divide-neutral-800/80 overflow-hidden">
              {paginatedChannels.map((ch) => {
                const isFav = favorites.includes(ch.id);
                const statusInfo = statusMap[ch.url];
                const isOffline = statusInfo?.status === 'offline';
                const isOnline = statusInfo?.status === 'online';

                return (
                  <div
                    key={ch.id}
                    onClick={() => onPlayChannel(ch, filteredChannels)}
                    className={`flex items-center justify-between p-3 sm:p-4 hover:bg-white/5 cursor-pointer transition-colors ${
                      isOffline ? 'opacity-65 hover:opacity-100 bg-red-950/10' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-black/60 border border-white/5 p-1 flex items-center justify-center shrink-0">
                        {ch.logo ? (
                          <img
                            src={ch.logo}
                            alt={ch.name}
                            className="w-full h-full object-contain"
                            onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                          />
                        ) : (
                          <Tv className="w-6 h-6 text-neutral-500" />
                        )}
                      </div>
                      <div className="truncate">
                        <div className="text-sm font-bold text-white truncate flex items-center space-x-2">
                          <span>{ch.name}</span>
                          {isOffline && (
                            <span className="px-1.5 py-0.5 rounded bg-red-950/90 border border-red-700/80 text-red-300 text-[10px] font-bold flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                              <span>Indisponível</span>
                            </span>
                          )}
                          {isOnline && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-700/80 text-emerald-300 text-[10px] font-bold flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              <span>Online</span>
                            </span>
                          )}
                          {ch.resolution && (
                            <span className="px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 text-[10px] font-mono">
                              {ch.resolution}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-neutral-400 mt-0.5 flex items-center space-x-2">
                          <span>{ch.group}</span>
                          {ch.country && <span>• 🏳️ {ch.country}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(ch.id);
                        }}
                        className="p-2 text-neutral-500 hover:text-amber-400 transition-colors"
                      >
                        <Star className={`w-4 h-4 ${isFav ? 'text-amber-400 fill-amber-400' : ''}`} />
                      </button>

                      <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center shadow-md ${isOffline ? 'bg-zinc-700' : 'bg-[#E50914]'}`}>
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-neutral-800 text-xs text-neutral-400">
              <div>
                Mostrando {((currentPage - 1) * ITEMS_PER_PAGE + 1).toLocaleString()} -{' '}
                {Math.min(currentPage * ITEMS_PER_PAGE, filteredChannels.length).toLocaleString()} de{' '}
                {filteredChannels.length.toLocaleString()} canais
              </div>

              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded bg-zinc-900 border border-neutral-800 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-800"
                  title="Página Anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center space-x-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = currentPage;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 rounded font-semibold transition-colors ${
                          currentPage === pageNum
                            ? 'bg-[#E50914] text-white'
                            : 'bg-zinc-900 text-neutral-300 hover:bg-neutral-800 border border-neutral-800'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded bg-zinc-900 border border-neutral-800 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-800"
                  title="Próxima Página"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Custom M3U Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181818] border border-neutral-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-2 flex items-center space-x-2">
              <LinkIcon className="w-5 h-5 text-[#E50914]" />
              <span>Adicionar Playlist M3U</span>
            </h2>
            <p className="text-neutral-400 text-xs mb-4">
              Insira o link de uma lista IPTV (.m3u / .m3u8) ou envie um arquivo .m3u salvo no seu computador.
            </p>

            <form onSubmit={handleCustomSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">URL da Lista M3U</label>
                <input
                  type="url"
                  placeholder="https://exemplo.com/lista.m3u"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  className="w-full bg-black/60 border border-neutral-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-[#E50914]"
                />
              </div>

              <div className="relative border-t border-neutral-800 pt-4">
                <label className="block text-xs font-semibold text-neutral-300 mb-2">Ou carregue um arquivo .m3u:</label>
                <label className="flex items-center justify-center space-x-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg p-3 text-xs font-semibold text-neutral-200 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" />
                  <span>Selecionar Arquivo .m3u do PC</span>
                  <input type="file" accept=".m3u,.m3u8" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] text-white rounded-lg text-xs font-semibold shadow-md"
                >
                  Carregar Lista
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
