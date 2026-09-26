import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Radio,
  Tv,
  Star,
  ChevronLeft,
  ChevronRight,
  List,
  RefreshCw,
  AlertCircle,
  Shield,
  Layers,
  Search,
  Cast,
  Download,
  Copy,
  Check,
  Settings2,
  SlidersHorizontal,
  Globe,
} from 'lucide-react';
import { IptvChannel } from '../types';

interface IptvPlayerModalProps {
  channel: IptvChannel;
  allChannels: IptvChannel[];
  favorites: string[];
  onToggleFavorite: (channelId: string) => void;
  onSelectChannel: (channel: IptvChannel) => void;
  onClose: () => void;
}

type StreamMode = 'proxy' | 'transmux' | 'direct';
type UserAgentProfile = 'vlc' | 'tivimate' | 'smarttv' | 'appletv' | 'chrome' | 'kodi';
type GeoProfile = 'auto' | 'BR' | 'PT' | 'US';

const USER_AGENTS: Record<UserAgentProfile, { label: string; value: string }> = {
  vlc: {
    label: 'VLC Media Player 3.0 (Padrão)',
    value: 'VLC/3.0.20 LibVLC/3.0.20 (Windows NT 10.0; Win64; x64)',
  },
  tivimate: {
    label: 'TiviMate IPTV Player',
    value: 'TiviMate/4.7.0 (Android TV; SDK 30)',
  },
  smarttv: {
    label: 'Smart TV (LG webOS / Samsung Tizen)',
    value: 'Mozilla/5.0 (Web0S; SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.128 Safari/537.36 WebAppManager',
  },
  appletv: {
    label: 'Apple TV / Safari HLS',
    value: 'AppleCoreMedia/1.0.0.18E182 (Apple TV; U; CPU OS 14_4 like Mac OS X; en_us)',
  },
  chrome: {
    label: 'Google Chrome Desktop',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  },
  kodi: {
    label: 'Kodi Media Center',
    value: 'Kodi/20.0 (Windows NT 10.0; Win64; x64) App_Bitness/64 Version/20.0-Git:20230115',
  },
};

export const IptvPlayerModal: React.FC<IptvPlayerModalProps> = ({
  channel,
  allChannels,
  favorites,
  onToggleFavorite,
  onSelectChannel,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Stream connection settings
  const [streamMode, setStreamMode] = useState<StreamMode>('proxy');
  const [uaProfile, setUaProfile] = useState<UserAgentProfile>('vlc');
  const [geoProfile, setGeoProfile] = useState<GeoProfile>('auto');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  // Zapping & UI
  const [showChannelList, setShowChannelList] = useState<boolean>(false);
  const [channelSearch, setChannelSearch] = useState<string>('');
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isFavorite = favorites.includes(channel.id);

  // Determine current channel index in the list for next/prev zapping
  const currentIndex = allChannels.findIndex((c) => c.id === channel.id);

  const handlePrevChannel = () => {
    if (currentIndex > 0) {
      onSelectChannel(allChannels[currentIndex - 1]);
    } else if (allChannels.length > 0) {
      onSelectChannel(allChannels[allChannels.length - 1]);
    }
  };

  const handleNextChannel = () => {
    if (currentIndex >= 0 && currentIndex < allChannels.length - 1) {
      onSelectChannel(allChannels[currentIndex + 1]);
    } else if (allChannels.length > 0) {
      onSelectChannel(allChannels[0]);
    }
  };

  // Build stream URL according to current mode & headers
  const getStreamUrl = useCallback(
    (rawUrl: string, mode: StreamMode, ua: UserAgentProfile, geo: GeoProfile) => {
      const selectedUa = channel.httpUserAgent || USER_AGENTS[ua].value;
      const selectedReferrer = channel.httpReferrer || '';
      const effectiveCountry = geo === 'auto' ? (channel.country || '') : geo;

      if (mode === 'transmux') {
        let transmuxUrl = `/api/iptv/transmux?url=${encodeURIComponent(rawUrl)}`;
        if (selectedUa) transmuxUrl += `&userAgent=${encodeURIComponent(selectedUa)}`;
        if (selectedReferrer) transmuxUrl += `&referrer=${encodeURIComponent(selectedReferrer)}`;
        if (effectiveCountry) transmuxUrl += `&country=${encodeURIComponent(effectiveCountry)}`;
        return transmuxUrl;
      }

      if (mode === 'proxy') {
        let proxyUrl = `/api/iptv/proxy?url=${encodeURIComponent(rawUrl)}`;
        if (selectedUa) proxyUrl += `&userAgent=${encodeURIComponent(selectedUa)}`;
        if (selectedReferrer) proxyUrl += `&referrer=${encodeURIComponent(selectedReferrer)}`;
        if (effectiveCountry) proxyUrl += `&country=${encodeURIComponent(effectiveCountry)}`;
        return proxyUrl;
      }

      return rawUrl;
    },
    [channel]
  );

  const reportChannelStatus = useCallback((status: 'online' | 'offline') => {
    fetch('/api/iptv/report-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: channel.url, status }),
    }).catch(() => {});
  }, [channel.url]);

  // Setup stream playback
  const loadStream = useCallback(
    (streamUrl: string, targetMode: StreamMode = streamMode) => {
      setIsLoading(true);
      setErrorMsg(null);

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const video = videoRef.current;
      if (!video) return;

      const effectiveUrl = getStreamUrl(streamUrl, targetMode, uaProfile, geoProfile);

      // Handle video tag native errors
      video.onerror = () => {
        setIsLoading(false);
        setIsPlaying(false);
        setErrorMsg('Não foi possível carregar a transmissão. O sinal pode estar temporariamente fora do ar ou com restrição regional.');
        reportChannelStatus('offline');
      };

      video.onplaying = () => {
        setIsLoading(false);
        setIsPlaying(true);
        reportChannelStatus('online');
      };

      // In transmux mode, we stream transcoded H.264/AAC directly to HTML5 video tag!
      if (targetMode === 'transmux') {
        video.src = effectiveUrl;
        video.load();
        video
          .play()
          .then(() => {
            setIsLoading(false);
            setIsPlaying(true);
            reportChannelStatus('online');
          })
          .catch((err) => {
            console.warn('[FFmpeg Transmux play notice]:', err);
          });
        return;
      }

      // In Proxy or Direct mode, try HLS.js first for .m3u8 streams
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: false, // Disabling worker allows robust ADTS/PES offset recovery on broadcast TS chunks
          lowLatencyMode: false, // Prevents aggressive fragment aborts on live IPTV feeds
          backBufferLength: 30,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferHole: 0.5,
          manifestLoadingTimeOut: 15000,
          manifestLoadingMaxRetry: 3,
          levelLoadingTimeOut: 15000,
          fragLoadingTimeOut: 15000,
          fragLoadingMaxRetry: 3,
          defaultAudioCodec: 'mp4a.40.2',
        });

        hls.loadSource(effectiveUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsLoading(false);
          reportChannelStatus('online');
          video.play().catch(() => {
            setIsPlaying(false);
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          console.warn('[HLS.js Live] Event Error:', data);
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR || data.details === Hls.ErrorDetails.FRAG_PARSING_ERROR) {
            console.log('[HLS.js] Tentando recuperação de MediaError / fragParsingError...');
            try {
              hls.recoverMediaError();
            } catch (err) {
              console.warn('[HLS.js] Falha na recuperação de mídia:', err);
            }
            return;
          }
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              console.log('[HLS.js] Tentando reconectar fluxo de rede...');
              hls.startLoad();
            } else {
              hls.destroy();
              setIsLoading(false);
              setIsPlaying(false);
              setErrorMsg('Sinal de transmissão com instabilidade ou formato incompatível no navegador. Experimente o Motor FFmpeg.');
              reportChannelStatus('offline');
            }
          }
        });

        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Safari / iOS HLS
        video.src = effectiveUrl;
        video.play().then(() => reportChannelStatus('online')).catch(() => setIsPlaying(false));
      } else {
        video.src = effectiveUrl;
        video.play().then(() => reportChannelStatus('online')).catch(() => setIsPlaying(false));
      }
    },
    [getStreamUrl, streamMode, uaProfile, geoProfile, reportChannelStatus]
  );

  useEffect(() => {
    setStreamMode('proxy');
    loadStream(channel.url, 'proxy');

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [channel.id]);

  // Handle controls auto-hide
  const handleMouseMove = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showChannelList && !showSettings) {
        setControlsVisible(false);
      }
    }, 4000);
  };

  // Keyboard navigation & shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSettings) {
          setShowSettings(false);
        } else if (showChannelList) {
          setShowChannelList(false);
        } else {
          onClose();
        }
      } else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrevChannel();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleNextChannel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showChannelList, showSettings, isPlaying, isMuted, currentIndex, allChannels]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => console.error(err));
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch((err) => console.error(err));
      setIsFullscreen(false);
    }
  };

  const handleCopyStreamUrl = () => {
    navigator.clipboard.writeText(channel.url).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    });
  };

  const handleDownloadM3u = () => {
    const link = `/api/iptv/export-m3u?url=${encodeURIComponent(channel.url)}&name=${encodeURIComponent(
      channel.name
    )}&logo=${encodeURIComponent(channel.logo || '')}&group=${encodeURIComponent(
      channel.group
    )}&userAgent=${encodeURIComponent(channel.httpUserAgent || USER_AGENTS[uaProfile].value)}`;
    window.location.href = link;
  };

  const filteredChannelList = allChannels.filter(
    (c) =>
      c.name.toLowerCase().includes(channelSearch.toLowerCase()) ||
      c.group.toLowerCase().includes(channelSearch.toLowerCase())
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center select-none overflow-hidden"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false);
          setErrorMsg(null);
        }}
        onError={() => {
          if (streamMode !== 'transmux') {
            setStreamMode('transmux');
            loadStream(channel.url, 'transmux');
          }
        }}
        playsInline
      />

      {/* Loading Spinner */}
      {isLoading && !errorMsg && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-xs pointer-events-none z-20">
          <div className="w-16 h-16 border-4 border-[#E50914] border-t-transparent rounded-full animate-spin mb-4 shadow-lg shadow-red-950/50"></div>
          <div className="flex items-center space-x-2 text-white font-medium text-lg">
            <Radio className="w-5 h-5 text-red-500 animate-pulse" />
            <span>Sintonizando {channel.name}...</span>
          </div>
          <span className="text-neutral-400 text-xs mt-1">
            {streamMode === 'transmux'
              ? 'Conectando via Motor FFmpeg (Modo VLC)...'
              : streamMode === 'proxy'
              ? 'Conectando via Proxy Anti-CORS & Emulação VLC...'
              : 'Conectando via Conexão Direta...'}
          </span>
        </div>
      )}

      {/* Error Overlay with VLC fallback */}
      {errorMsg && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md z-25 p-6 text-center max-w-xl mx-auto">
          <AlertCircle className="w-14 h-14 text-amber-500 mb-3 animate-bounce" />
          <h3 className="text-xl font-bold text-white mb-2">Canal Indisponível no Navegador</h3>
          <p className="text-neutral-300 text-sm mb-5 leading-relaxed">{errorMsg}</p>

          {/* Quick Troubleshooting Options */}
          <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 w-full mb-5 text-left text-xs space-y-3">
            <div className="font-semibold text-neutral-200 flex items-center space-x-1.5">
              <SlidersHorizontal className="w-4 h-4 text-red-500" />
              <span>Opções de Recuperação de Sinal:</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setStreamMode('transmux');
                  loadStream(channel.url, 'transmux');
                }}
                className={`px-3 py-2 rounded-lg font-medium flex items-center space-x-2 transition-all border cursor-pointer ${
                  streamMode === 'transmux'
                    ? 'bg-purple-900/60 border-purple-600 text-white'
                    : 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-700'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5 text-purple-400" />
                <span>Motor FFmpeg (H.264 Web)</span>
              </button>
              <button
                onClick={() => {
                  setStreamMode('proxy');
                  setUaProfile('smarttv');
                  loadStream(channel.url, 'proxy');
                }}
                className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium flex items-center space-x-2 transition-all border border-neutral-700 cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                <span>Perfil Smart TV (LG/Samsung)</span>
              </button>
              <button
                onClick={() => {
                  setStreamMode('proxy');
                  setUaProfile('tivimate');
                  loadStream(channel.url, 'proxy');
                }}
                className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium flex items-center space-x-2 transition-all border border-neutral-700 cursor-pointer"
              >
                <Tv className="w-3.5 h-3.5 text-emerald-400" />
                <span>Perfil TiviMate IPTV</span>
              </button>
              <button
                onClick={() => {
                  setStreamMode('proxy');
                  setUaProfile('vlc');
                  loadStream(channel.url, 'proxy');
                }}
                className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium flex items-center space-x-2 transition-all border border-neutral-700 cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                <span>Proxy VLC Padrão</span>
              </button>
            </div>
            <div className="text-[11px] text-neutral-400 pt-1 border-t border-neutral-800/80">
              💡 <strong>Nota:</strong> Canais com bloqueio geográfico estrito no servidor de transmissão exigem rede local ou IP permitido.
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleDownloadM3u}
              className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-semibold flex items-center space-x-2 shadow-lg transition-all cursor-pointer"
              title="Baixar arquivo .m3u para abrir direto no aplicativo VLC do seu computador"
            >
              <Download className="w-4 h-4" />
              <span>Abrir no VLC (.m3u)</span>
            </button>
            <button
              onClick={handleCopyStreamUrl}
              className="px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-sm font-semibold flex items-center space-x-2 border border-neutral-700 transition-all cursor-pointer"
            >
              {copiedUrl ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copiedUrl ? 'Link Copiado!' : 'Copiar Link'}</span>
            </button>
            <button
              onClick={handleNextChannel}
              className="px-4 py-2.5 bg-[#E50914] hover:bg-[#b80710] text-white rounded-lg text-sm font-semibold transition-all cursor-pointer"
            >
              Próximo Canal &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Header Overlay */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-b from-black/90 via-black/50 to-transparent flex items-center justify-between transition-opacity duration-300 z-30 ${
          controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center space-x-3 sm:space-x-4">
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-black/60 hover:bg-white/20 text-neutral-300 hover:text-white transition-all cursor-pointer"
            title="Fechar (Esc)"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          {/* Logo & Channel Info */}
          <div className="flex items-center space-x-3">
            {channel.logo ? (
              <img
                src={channel.logo}
                alt={channel.name}
                className="w-10 h-10 sm:w-12 sm:h-12 object-contain bg-neutral-900/80 rounded-lg p-1 border border-neutral-800 shrink-0"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-red-950/60 border border-red-900/40 flex items-center justify-center shrink-0">
                <Tv className="w-6 h-6 text-red-400" />
              </div>
            )}

            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-white text-base sm:text-lg font-bold truncate max-w-[180px] sm:max-w-md">
                  {channel.name}
                </h1>
                <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-red-600/90 text-white text-[10px] font-black uppercase tracking-wider animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                  <span>AO VIVO</span>
                </span>
                {channel.resolution && (
                  <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700 text-[10px] font-mono font-bold">
                    {channel.resolution}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2 text-xs text-neutral-400 mt-0.5">
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-neutral-300 text-[11px]">
                  {channel.group}
                </span>
                {channel.country && <span>🏳️ {channel.country}</span>}
                <span
                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
                    streamMode === 'transmux'
                      ? 'bg-purple-950/60 border-purple-800 text-purple-400'
                      : streamMode === 'proxy'
                      ? 'bg-emerald-950/60 border-emerald-800 text-emerald-400'
                      : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                  }`}
                >
                  {streamMode === 'transmux' ? '⚡ FFmpeg Transmux' : streamMode === 'proxy' ? '🛡️ Proxy VLC' : 'Direto'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Top Right Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2.5 rounded-full transition-all cursor-pointer ${
              showSettings
                ? 'bg-[#E50914] text-white'
                : 'bg-black/60 hover:bg-white/20 text-neutral-300 hover:text-white'
            }`}
            title="Configurações de Transmissão (VLC / Headers / Modos)"
          >
            <Settings2 className="w-5 h-5" />
          </button>

          <button
            onClick={() => onToggleFavorite(channel.id)}
            className={`p-2.5 rounded-full transition-all cursor-pointer ${
              isFavorite
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-black/60 hover:bg-white/20 text-neutral-300 hover:text-white'
            }`}
            title={isFavorite ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
          >
            <Star className={`w-5 h-5 ${isFavorite ? 'fill-amber-400' : ''}`} />
          </button>

          <button
            onClick={() => setShowChannelList(!showChannelList)}
            className={`p-2.5 rounded-full transition-all cursor-pointer flex items-center space-x-1.5 ${
              showChannelList
                ? 'bg-[#E50914] text-white'
                : 'bg-black/60 hover:bg-white/20 text-neutral-300 hover:text-white'
            }`}
            title="Guia de Canais (Zapping)"
          >
            <List className="w-5 h-5" />
            <span className="text-xs font-semibold hidden md:inline">Guia de Canais</span>
          </button>

          <button
            onClick={onClose}
            className="p-2.5 rounded-full bg-black/60 hover:bg-red-600/80 text-neutral-300 hover:text-white transition-all cursor-pointer"
            title="Fechar Player"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Settings Flyout Panel */}
      {showSettings && (
        <div className="absolute top-20 right-4 sm:right-6 w-84 sm:w-96 bg-neutral-900/95 backdrop-blur-xl border border-neutral-800 rounded-2xl p-5 shadow-2xl z-40 text-left text-xs text-neutral-300 space-y-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
            <div className="flex items-center space-x-2 text-white font-bold text-sm">
              <SlidersHorizontal className="w-4 h-4 text-[#E50914]" />
              <span>Ajustes de Transmissão</span>
            </div>
            <button
              onClick={() => setShowSettings(false)}
              className="text-neutral-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Engine Mode */}
          <div>
            <label className="block text-neutral-400 font-semibold mb-1.5">Modo de Reprodução:</label>
            <div className="grid grid-cols-3 gap-1.5 bg-black/60 p-1 rounded-lg border border-neutral-800">
              <button
                onClick={() => {
                  setStreamMode('proxy');
                  loadStream(channel.url, 'proxy');
                }}
                className={`py-1.5 px-2 rounded font-medium text-[11px] transition-all cursor-pointer ${
                  streamMode === 'proxy'
                    ? 'bg-emerald-600 text-white font-bold shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Proxy HLS
              </button>
              <button
                onClick={() => {
                  setStreamMode('transmux');
                  loadStream(channel.url, 'transmux');
                }}
                className={`py-1.5 px-2 rounded font-medium text-[11px] transition-all cursor-pointer ${
                  streamMode === 'transmux'
                    ? 'bg-purple-600 text-white font-bold shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                FFmpeg TS
              </button>
              <button
                onClick={() => {
                  setStreamMode('direct');
                  loadStream(channel.url, 'direct');
                }}
                className={`py-1.5 px-2 rounded font-medium text-[11px] transition-all cursor-pointer ${
                  streamMode === 'direct'
                    ? 'bg-neutral-700 text-white font-bold shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Direto
              </button>
            </div>
            <p className="text-[10px] text-neutral-400 mt-1">
              * O modo <strong>FFmpeg TS</strong> converte fluxos MPEG-TS brutos diretamente em vídeo web compatível.
            </p>
          </div>

          {/* User-Agent Emulation */}
          <div>
            <label className="block text-neutral-400 font-semibold mb-1.5">Identificação (User-Agent):</label>
            <select
              value={uaProfile}
              onChange={(e) => {
                const val = e.target.value as UserAgentProfile;
                setUaProfile(val);
                loadStream(channel.url);
              }}
              className="w-full bg-black/60 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500 cursor-pointer"
            >
              <option value="vlc">VLC Media Player 3.0 (Padrão)</option>
              <option value="tivimate">TiviMate IPTV Player</option>
              <option value="smarttv">Smart TV (LG / Samsung)</option>
              <option value="appletv">Apple TV / Safari HLS</option>
              <option value="chrome">Google Chrome Desktop</option>
              <option value="kodi">Kodi Media Center</option>
            </select>
          </div>

          {/* Geo-IP Simulation */}
          <div>
            <label className="block text-neutral-400 font-semibold mb-1.5 flex items-center space-x-1.5">
              <Globe className="w-3.5 h-3.5 text-blue-400" />
              <span>Simulação de Cabeçalho Regional:</span>
            </label>
            <select
              value={geoProfile}
              onChange={(e) => {
                const val = e.target.value as GeoProfile;
                setGeoProfile(val);
                loadStream(channel.url);
              }}
              className="w-full bg-black/60 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500 cursor-pointer"
            >
              <option value="auto">Automático (Origem do canal: {channel.country || 'Global'})</option>
              <option value="BR">Brasil 🇧🇷 (IP Forwarding BR)</option>
              <option value="PT">Portugal 🇵🇹 (IP Forwarding PT)</option>
              <option value="US">Estados Unidos 🇺🇸 (IP Forwarding US)</option>
            </select>
          </div>

          {/* External VLC Launcher Actions */}
          <div className="pt-2 border-t border-neutral-800 flex items-center space-x-2">
            <button
              onClick={handleDownloadM3u}
              className="flex-1 py-2 px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar para VLC</span>
            </button>
            <button
              onClick={handleCopyStreamUrl}
              className="py-2 px-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedUrl ? 'Copiado' : 'Link'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/60 to-transparent flex items-center justify-between transition-opacity duration-300 z-30 ${
          controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Left: Play/Pause, Prev/Next Channel, Volume */}
        <div className="flex items-center space-x-3 sm:space-x-5">
          <button
            onClick={togglePlay}
            className="p-2.5 sm:p-3 rounded-full bg-white text-black hover:bg-neutral-200 transition-all shadow-lg active:scale-95 cursor-pointer"
            title={isPlaying ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          {/* Zapping Prev / Next Buttons */}
          <div className="flex items-center space-x-1 bg-black/50 border border-neutral-800 rounded-lg p-1">
            <button
              onClick={handlePrevChannel}
              className="p-2 rounded hover:bg-white/10 text-neutral-300 hover:text-white transition-colors cursor-pointer"
              title="Canal Anterior (Seta Cima)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-mono text-neutral-400 px-1 hidden sm:inline">
              {currentIndex + 1} / {allChannels.length}
            </span>
            <button
              onClick={handleNextChannel}
              className="p-2 rounded hover:bg-white/10 text-neutral-300 hover:text-white transition-colors cursor-pointer"
              title="Próximo Canal (Seta Baixo)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Volume Slider */}
          <div className="flex items-center space-x-2 group">
            <button
              onClick={toggleMute}
              className="p-2 text-neutral-300 hover:text-white transition-colors cursor-pointer"
              title="Mudo (M)"
            >
              {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-16 sm:w-24 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-[#E50914]"
            />
          </div>
        </div>

        {/* Right Controls: Mode Toggle, Fullscreen */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              const nextMode: StreamMode =
                streamMode === 'proxy' ? 'transmux' : streamMode === 'transmux' ? 'direct' : 'proxy';
              setStreamMode(nextMode);
              loadStream(channel.url, nextMode);
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-all border cursor-pointer ${
              streamMode === 'transmux'
                ? 'bg-purple-950/60 border-purple-700 text-purple-300'
                : streamMode === 'proxy'
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-400'
                : 'bg-black/60 border-neutral-700 text-neutral-300 hover:text-white hover:bg-white/10'
            }`}
            title="Clique para alternar entre Proxy HLS, FFmpeg TS e Conexão Direta"
          >
            {streamMode === 'transmux' ? (
              <RefreshCw className="w-3.5 h-3.5 text-purple-400 animate-spin" />
            ) : (
              <Shield className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">
              {streamMode === 'transmux'
                ? 'Motor FFmpeg (VLC)'
                : streamMode === 'proxy'
                ? 'Proxy Anti-CORS'
                : 'Conexão Direta'}
            </span>
            <span className="sm:hidden">
              {streamMode === 'transmux' ? 'FFmpeg' : streamMode === 'proxy' ? 'Proxy' : 'Direto'}
            </span>
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2.5 rounded-full bg-black/60 hover:bg-white/20 text-neutral-300 hover:text-white transition-all cursor-pointer"
            title="Tela Cheia (F)"
          >
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Side Channel Zapping Drawer (EPG / List style) */}
      {showChannelList && (
        <div className="absolute top-0 right-0 bottom-0 w-80 sm:w-96 bg-[#141414]/95 backdrop-blur-xl border-l border-neutral-800 z-40 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
          <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <List className="w-5 h-5 text-[#E50914]" />
              <h2 className="text-white font-bold text-sm sm:text-base">Guia de Canais</h2>
            </div>
            <button
              onClick={() => setShowChannelList(false)}
              className="p-1 text-neutral-400 hover:text-white rounded-md hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick search input in drawer */}
          <div className="p-3 border-b border-neutral-800">
            <div className="flex items-center bg-black/60 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-white">
              <Search className="w-3.5 h-3.5 text-neutral-400 mr-2 shrink-0" />
              <input
                type="text"
                placeholder="Buscar canal..."
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                className="bg-transparent border-none focus:outline-none w-full text-white placeholder-neutral-500"
              />
              {channelSearch && (
                <button onClick={() => setChannelSearch('')} className="text-neutral-400 hover:text-white text-xs">
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Channels list scroll */}
          <div className="flex-1 overflow-y-auto divide-y divide-neutral-900/80 p-2 space-y-1">
            {filteredChannelList.length === 0 ? (
              <div className="text-center py-10 text-neutral-500 text-xs">Nenhum canal encontrado</div>
            ) : (
              filteredChannelList.map((ch) => {
                const isSelected = ch.id === channel.id;
                const isFav = favorites.includes(ch.id);
                return (
                  <div
                    key={ch.id}
                    onClick={() => {
                      onSelectChannel(ch);
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-[#E50914]/20 border border-[#E50914]/40 text-white'
                        : 'hover:bg-white/5 text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 overflow-hidden">
                      {ch.logo ? (
                        <img
                          src={ch.logo}
                          alt={ch.name}
                          className="w-8 h-8 object-contain bg-black/60 rounded p-0.5 shrink-0"
                          onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-neutral-800 flex items-center justify-center shrink-0">
                          <Tv className="w-4 h-4 text-neutral-400" />
                        </div>
                      )}
                      <div className="truncate">
                        <div className="text-xs font-semibold truncate">{ch.name}</div>
                        <div className="text-[10px] text-neutral-500 truncate">{ch.group}</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0 ml-2">
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-ping mr-1"></span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(ch.id);
                        }}
                        className="p-1 text-neutral-500 hover:text-amber-400"
                      >
                        <Star className={`w-3.5 h-3.5 ${isFav ? 'text-amber-400 fill-amber-400' : ''}`} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
