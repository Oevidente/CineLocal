import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Subtitles,
  Settings,
  AlertTriangle,
  Loader2,
  Radio,
  Users,
  Download,
  Upload,
  Cast as CastIcon,
  SkipForward,
  SkipBack,
  Check,
  Plus,
  Tv,
  Layers,
  List,
  X,
} from 'lucide-react';
import { TorrentStatus, TorrentFileItem, MediaItem, Episode } from '../types';
import { formatTime, formatBytes } from '../utils';
import {
  getCastContext,
  getCastErrorMessage,
  resolveCastBaseUrls,
  subscribeToCastAvailability,
} from '../cast';

interface TorrentPlayerProps {
  status: TorrentStatus;
  selectedFileIndex: number;
  media?: MediaItem | null;
  onClose: () => void;
  onSelectFile?: (fileIndex: number) => void;
}

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface ParsedPlayerEpisode {
  id?: string;
  fileIndex: number;
  fileName: string;
  seasonNumber: number;
  episodeNumber: number;
  cleanTitle: string;
  length: number;
  infoHash?: string;
  magnetUri?: string;
}

function parseSubtitleTime(value: string): number {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0]) || 0;
}

function parseSrtOrVtt(text: string): SubtitleCue[] {
  return text
    .replace(/^WEBVTT[^\n]*\n/i, '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n');
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex < 0) return null;

      const [start, endWithSettings] = lines[timingIndex].split('-->');
      const end = endWithSettings.trim().split(/\s+/)[0];
      const cueText = lines
        .slice(timingIndex + 1)
        .join('\n')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!cueText) return null;

      return {
        start: parseSubtitleTime(start),
        end: parseSubtitleTime(end),
        text: cueText,
      };
    })
    .filter((cue): cue is SubtitleCue => !!cue && cue.end > cue.start)
    .sort((a, b) => a.start - b.start);
}

function parseEpisodeInfoFromFileName(file: TorrentFileItem, fallbackIndex: number): ParsedPlayerEpisode {
  const normalizedPath = (file.path || file.name).replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/').filter(Boolean);
  const fileName = pathParts[pathParts.length - 1] || file.name;
  const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

  let pathSeason: number | undefined;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];
    const sMatch = part.match(/(?:temporada|season|s)\s*(\d{1,2})/i);
    if (sMatch) {
      const parsedS = parseInt(sMatch[1], 10);
      if (parsedS > 0 && parsedS < 100) pathSeason = parsedS;
    }
  }

  const sxxExx = nameWithoutExt.match(/[Ss](\d{1,2})[\.\s_-]*[Ee](\d{1,3})/);
  if (sxxExx) {
    const s = parseInt(sxxExx[1], 10);
    const e = parseInt(sxxExx[2], 10);
    let title = nameWithoutExt.substring(nameWithoutExt.indexOf(sxxExx[0]) + sxxExx[0].length);
    title = cleanRawPlayerTitle(title);
    return {
      fileIndex: file.index,
      fileName: file.name,
      seasonNumber: s || pathSeason || 1,
      episodeNumber: e,
      cleanTitle: title || `Episódio ${e}`,
      length: file.length || 0,
    };
  }

  const xMatch = nameWithoutExt.match(/(?:^|[\s._\-\[])(\d{1,2})[xX](\d{1,3})/);
  if (xMatch) {
    const s = parseInt(xMatch[1], 10);
    const e = parseInt(xMatch[2], 10);
    let title = nameWithoutExt.substring(nameWithoutExt.indexOf(xMatch[0]) + xMatch[0].length);
    title = cleanRawPlayerTitle(title);
    return {
      fileIndex: file.index,
      fileName: file.name,
      seasonNumber: s || pathSeason || 1,
      episodeNumber: e,
      cleanTitle: title || `Episódio ${e}`,
      length: file.length || 0,
    };
  }

  const seasonEpMatch = nameWithoutExt.match(/(?:temporada|season)\s*(\d{1,2})[\s\S]*?(?:episodio|episódio|ep|episode)\s*(\d{1,3})/i);
  if (seasonEpMatch) {
    const s = parseInt(seasonEpMatch[1], 10);
    const e = parseInt(seasonEpMatch[2], 10);
    return {
      fileIndex: file.index,
      fileName: file.name,
      seasonNumber: s || pathSeason || 1,
      episodeNumber: e,
      cleanTitle: `Episódio ${e}`,
      length: file.length || 0,
    };
  }

  const epOnly = nameWithoutExt.match(/(?:^|[\s._\-\[])(?:[Ee][Pp]?|episodio|episódio)\s*[-_.]?\s*(\d{1,3})/i);
  if (epOnly) {
    const e = parseInt(epOnly[1], 10);
    let title = nameWithoutExt.substring(nameWithoutExt.indexOf(epOnly[0]) + epOnly[0].length);
    title = cleanRawPlayerTitle(title);
    return {
      fileIndex: file.index,
      fileName: file.name,
      seasonNumber: pathSeason || 1,
      episodeNumber: e,
      cleanTitle: title || `Episódio ${e}`,
      length: file.length || 0,
    };
  }

  const animeMatch = nameWithoutExt.match(/(?:^|[\s._\-\]])-\s*(\d{1,3})(?:[\s._\-\[]|$)/);
  if (animeMatch) {
    const e = parseInt(animeMatch[1], 10);
    return {
      fileIndex: file.index,
      fileName: file.name,
      seasonNumber: pathSeason || 1,
      episodeNumber: e,
      cleanTitle: `Episódio ${e}`,
      length: file.length || 0,
    };
  }

  const leadingNum = nameWithoutExt.match(/^(\d{1,3})[\s\.\-_]*(.*)/);
  if (leadingNum) {
    const e = parseInt(leadingNum[1], 10);
    const title = cleanRawPlayerTitle(leadingNum[2]);
    return {
      fileIndex: file.index,
      fileName: file.name,
      seasonNumber: pathSeason || 1,
      episodeNumber: e,
      cleanTitle: title || `Episódio ${e}`,
      length: file.length || 0,
    };
  }

  return {
    fileIndex: file.index,
    fileName: file.name,
    seasonNumber: pathSeason || 1,
    episodeNumber: fallbackIndex,
    cleanTitle: cleanRawPlayerTitle(nameWithoutExt) || `Vídeo ${fallbackIndex}`,
    length: file.length || 0,
  };
}

function cleanRawPlayerTitle(raw: string): string {
  return raw
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web-dl|webdl|hdtv|x264|x265|hevc|avc|aac|dts|ddp|ac3|yify|yts|eztv|tgx|rarbg|galaxytv|dual|dublado|legendado|multi|ita|eng|por)\b/gi, ' ')
    .replace(/[\._]/g, ' ')
    .replace(/^[-\s.:]+|[-\s.:]+$/g, '')
    .trim();
}

export const TorrentPlayer: React.FC<TorrentPlayerProps> = ({
  status: initialStatus,
  selectedFileIndex: initialFileIdx,
  media,
  onClose,
  onSelectFile,
}) => {
  const [status, setStatus] = useState<TorrentStatus>(initialStatus);
  const [currentFileIdx, setCurrentFileIdx] = useState<number>(initialFileIdx);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showSubModal, setShowSubModal] = useState(false);
  const [showEpisodesDrawer, setShowEpisodesDrawer] = useState(false);
  const [selectedSeasonTab, setSelectedSeasonTab] = useState<number | 'all'>('all');
  const [forceTranscode, setForceTranscode] = useState(false);

  // Auto-play next episode countdown
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);

  // Subtitle state
  const [subtitles, setSubtitles] = useState<{ name: string; cues: SubtitleCue[] }[]>([]);
  const [selectedSubIdx, setSelectedSubIdx] = useState<number>(-1);
  const [subOffsetSeconds, setSubOffsetSeconds] = useState<number>(0);
  const [subSize, setSubSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [currentSubText, setCurrentSubText] = useState<string>('');

  // Cast state
  const [castAvailable, setCastAvailable] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const [isCastLoading, setIsCastLoading] = useState(false);
  const [castDeviceName, setCastDeviceName] = useState<string | null>(null);
  const castSessionRef = useRef<any>(null);
  const castMediaRef = useRef<any>(null);
  const castStartTimeRef = useRef<number>(0);
  const castCurrentTimeRef = useRef<number>(0);
  const isConnectingCastRef = useRef<boolean>(false);
  const isDisconnectingCastRef = useRef<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideControlsTimer = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoFiles = useMemo(() => status.files?.filter((f) => f.isVideo) || [], [status.files]);
  const currentFile = status.files?.find((f) => f.index === currentFileIdx) || videoFiles[0];

  // Parse all video files or media seasons into structured episodes
  const parsedEpisodes: ParsedPlayerEpisode[] = useMemo(() => {
    // If media is a series with seasons, prefer full series episode roster
    if (media && media.kind === 'series' && Array.isArray(media.seasons) && media.seasons.length > 0) {
      const allEps: ParsedPlayerEpisode[] = [];
      media.seasons.forEach((season) => {
        season.episodes.forEach((ep) => {
          allEps.push({
            id: ep.id,
            fileIndex: ep.fileIndex ?? 0,
            fileName: ep.fileName || ep.title,
            seasonNumber: ep.seasonNumber || season.seasonNumber || 1,
            episodeNumber: ep.episodeNumber || 1,
            cleanTitle: ep.title || `Episódio ${ep.episodeNumber}`,
            length: ep.sizeBytes || 0,
            infoHash: ep.infoHash || (ep.filePath?.startsWith('torrent://') ? ep.filePath.replace('torrent://', '').split('/')[0] : status.infoHash),
            magnetUri: ep.magnetUri,
          });
        });
      });
      if (allEps.length > 0) {
        allEps.sort((a, b) => {
          if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
          return a.episodeNumber - b.episodeNumber;
        });
        return allEps;
      }
    }

    return videoFiles.map((file, idx) => ({
      ...parseEpisodeInfoFromFileName(file, idx + 1),
      infoHash: status.infoHash,
      magnetUri: status.magnetUri,
    }));
  }, [videoFiles, media, status.infoHash, status.magnetUri]);

  const currentParsedEp = useMemo(() => {
    return (
      parsedEpisodes.find(
        (e) =>
          (e.infoHash?.toLowerCase() === status.infoHash.toLowerCase() && e.fileIndex === currentFileIdx) ||
          e.fileIndex === currentFileIdx
      ) || parsedEpisodes[0]
    );
  }, [parsedEpisodes, currentFileIdx, status.infoHash]);

  // Unique seasons list
  const availableSeasons = useMemo(() => {
    const set = new Set<number>();
    parsedEpisodes.forEach((e) => set.add(e.seasonNumber));
    return Array.from(set).sort((a, b) => a - b);
  }, [parsedEpisodes]);

  // Next and Previous episodes
  const currentIdxInEpisodes = useMemo(() => {
    return parsedEpisodes.findIndex(
      (e) =>
        (e.infoHash?.toLowerCase() === status.infoHash.toLowerCase() && e.fileIndex === currentFileIdx) ||
        (e.fileIndex === currentFileIdx && (!e.infoHash || e.infoHash.toLowerCase() === status.infoHash.toLowerCase()))
    );
  }, [parsedEpisodes, currentFileIdx, status.infoHash]);

  const nextParsedEp = useMemo(() => {
    if (currentIdxInEpisodes >= 0 && currentIdxInEpisodes < parsedEpisodes.length - 1) {
      return parsedEpisodes[currentIdxInEpisodes + 1];
    }
    return null;
  }, [parsedEpisodes, currentIdxInEpisodes]);

  const prevParsedEp = useMemo(() => {
    if (currentIdxInEpisodes > 0) {
      return parsedEpisodes[currentIdxInEpisodes - 1];
    }
    return null;
  }, [parsedEpisodes, currentIdxInEpisodes]);

  // Poll torrent status for peers / download speed HUD
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/torrent/status/${status.infoHash}`);
        if (res.ok) {
          const updated: TorrentStatus = await res.json();
          setStatus(updated);
        }
      } catch {}
    }, 2000);

    return () => clearInterval(interval);
  }, [status.infoHash]);

  // Handle user activity to show/hide controls
  const handleUserActivity = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false);
        setShowSubModal(false);
        setShowEpisodesDrawer(false);
      }
    }, 3500);
  }, []);

  // Save watch progress
  const saveProgress = useCallback(
    (timeSec: number, totalDur?: number) => {
      if (timeSec < 0 || isNaN(timeSec)) return;
      try {
        fetch('/api/torrent/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            infoHash: status.infoHash,
            magnetUri: status.magnetUri,
            name: status.name,
            progressSeconds: Math.floor(timeSec),
            durationSeconds: Math.floor(totalDur || duration),
            selectedFileIndex: currentFileIdx,
            totalBytes: status.totalBytes,
          }),
        }).catch(() => {});
      } catch {}
    },
    [status.infoHash, status.magnetUri, status.name, status.totalBytes, duration, currentFileIdx]
  );

  // Periodic progress saving
  useEffect(() => {
    const timer = setInterval(() => {
      if (isPlaying && currentTime > 0) {
        saveProgress(currentTime, duration);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [isPlaying, currentTime, duration, saveProgress]);

  // Auto-play Next Episode Countdown Trigger (when near end of episode)
  useEffect(() => {
    if (!nextParsedEp || duration <= 30) {
      setNextCountdown(null);
      return;
    }

    const timeLeft = duration - currentTime;
    if (timeLeft > 0 && timeLeft <= 15 && isPlaying) {
      if (nextCountdown === null) {
        setNextCountdown(Math.ceil(timeLeft));
      }
    } else if (timeLeft > 15) {
      setNextCountdown(null);
    }
  }, [currentTime, duration, isPlaying, nextParsedEp, nextCountdown]);

  // Countdown timer effect
  useEffect(() => {
    if (nextCountdown === null) return;
    if (nextCountdown <= 0) {
      // Trigger next episode
      if (nextParsedEp) {
        handlePlayNextEpisode();
      }
      setNextCountdown(null);
      return;
    }

    const timer = setTimeout(() => {
      setNextCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [nextCountdown, nextParsedEp]);

  const switchToEpisode = async (targetEp: ParsedPlayerEpisode) => {
    if (videoRef.current) {
      saveProgress(videoRef.current.currentTime, videoRef.current.duration);
    }
    setNextCountdown(null);
    setIsBuffering(true);

    const cleanTargetHash = targetEp.infoHash?.toLowerCase();
    const cleanCurrentHash = status.infoHash.toLowerCase();

    if (cleanTargetHash && cleanTargetHash !== cleanCurrentHash) {
      const magnetToStart = targetEp.magnetUri || `magnet:?xt=urn:btih:${cleanTargetHash}`;
      try {
        const res = await fetch('/api/torrent/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ magnetUri: magnetToStart }),
        });
        if (res.ok) {
          const newStatus: TorrentStatus = await res.json();
          setStatus(newStatus);
          setCurrentFileIdx(targetEp.fileIndex);
          if (onSelectFile) onSelectFile(targetEp.fileIndex);
          setShowEpisodesDrawer(false);
          return;
        }
      } catch (err) {
        console.error('Erro ao alternar torrent do episódio:', err);
      }
    }

    setCurrentFileIdx(targetEp.fileIndex);
    if (onSelectFile) onSelectFile(targetEp.fileIndex);
    setShowEpisodesDrawer(false);
  };

  const handlePlayNextEpisode = () => {
    if (!nextParsedEp) return;
    switchToEpisode(nextParsedEp);
  };

  const handlePlayPrevEpisode = () => {
    if (!prevParsedEp) return;
    switchToEpisode(prevParsedEp);
  };

  const handleSwitchEpisode = (fileIndex: number, epItem?: ParsedPlayerEpisode) => {
    const target = epItem || parsedEpisodes.find((e) => e.fileIndex === fileIndex) || parsedEpisodes[0];
    if (target) {
      switchToEpisode(target);
    }
  };

  // Google Cast Restore
  const restoreLocalFromCast = useCallback(() => {
    const resumePos = castCurrentTimeRef.current;
    if (videoRef.current && Number.isFinite(resumePos) && resumePos >= 0) {
      try {
        videoRef.current.currentTime = resumePos;
        setCurrentTime(resumePos);
      } catch {}
      videoRef.current.play().catch(() => {});
    }
    castMediaRef.current = null;
    castSessionRef.current = null;
    setIsCasting(false);
    setCastDeviceName(null);
  }, []);

  const disconnectCast = useCallback(async () => {
    if (isDisconnectingCastRef.current) return;
    isDisconnectingCastRef.current = true;
    setIsCastLoading(true);

    try {
      const context = getCastContext();
      const session = castSessionRef.current || context?.getCurrentSession?.();
      const remoteMedia = castMediaRef.current || session?.getMediaSession?.();
      const estimatedTime = remoteMedia?.getEstimatedTime?.();

      if (typeof estimatedTime === 'number' && Number.isFinite(estimatedTime)) {
        castCurrentTimeRef.current = estimatedTime;
        setCurrentTime(estimatedTime);
      }

      restoreLocalFromCast();

      try {
        if (typeof session?.endSession === 'function') {
          await session.endSession(true);
        } else if (typeof context?.endCurrentSession === 'function') {
          await context.endCurrentSession(true);
        }
      } catch {}
    } finally {
      setIsCastLoading(false);
      isDisconnectingCastRef.current = false;
    }
  }, [restoreLocalFromCast]);

  // Start Cast
  const handleStartCast = async () => {
    if (isCasting) {
      await disconnectCast();
      return;
    }

    const context = getCastContext();
    if (!context) return;
    setIsCastLoading(true);
    isConnectingCastRef.current = true;

    try {
      let session = context.getCurrentSession?.();
      if (!session) {
        await context.requestSession();
        session = context.getCurrentSession?.();
      }

      if (!session) {
        setIsCastLoading(false);
        isConnectingCastRef.current = false;
        return;
      }

      const video = videoRef.current;
      const pos = video ? video.currentTime : currentTime;

      if (video && !video.paused) {
        try {
          video.pause();
        } catch {}
      }

      castSessionRef.current = session;
      castStartTimeRef.current = pos;
      castCurrentTimeRef.current = pos;
      const device = session.getCastDevice?.();
      setCastDeviceName(device?.friendlyName || 'Chromecast');
      setIsCasting(true);

      const castUrls = await resolveCastBaseUrls();
      const castBase = castUrls[0] || window.location.origin;
      const castMediaUrl = `${castBase}/api/torrent/stream/${status.infoHash}/${currentFileIdx}?cast=1`;

      const mediaInfo = new (window as any).chrome.cast.media.MediaInfo(castMediaUrl, 'video/mp4');
      mediaInfo.metadata = new (window as any).chrome.cast.media.GenericMediaMetadata();
      mediaInfo.metadata.title = currentParsedEp?.cleanTitle || currentFile?.name || status.name;
      mediaInfo.metadata.subtitle = `CineLocal • ${status.name}`;

      const request = new (window as any).chrome.cast.media.LoadRequest(mediaInfo);
      request.currentTime = pos;
      request.autoplay = true;

      await session.loadMedia(request);

      const remoteMedia = session.getMediaSession?.();
      if (remoteMedia) {
        castMediaRef.current = remoteMedia;
        const updateListener = () => {
          const estimated = remoteMedia.getEstimatedTime?.();
          if (typeof estimated === 'number' && Number.isFinite(estimated)) {
            castCurrentTimeRef.current = estimated;
            setCurrentTime(estimated);
          }
          if (remoteMedia.playerState === 'PLAYING' || remoteMedia.playerState === 'BUFFERING') {
            setIsPlaying(true);
          } else if (remoteMedia.playerState === 'PAUSED') {
            setIsPlaying(false);
          }
        };
        remoteMedia.addUpdateListener?.(updateListener);
      }
    } catch (err: any) {
      console.error('Erro ao transmitir para o Cast:', err);
      restoreLocalFromCast();
    } finally {
      setIsCastLoading(false);
      isConnectingCastRef.current = false;
    }
  };

  // Google Cast Listener
  useEffect(() => {
    let cleanupEvents = () => {};
    const unsubscribe = subscribeToCastAvailability((context) => {
      cleanupEvents();
      cleanupEvents = () => {};

      if (!context) {
        setCastAvailable(false);
        return;
      }
      setCastAvailable(true);
      const eventTypes = (window as any).cast?.framework?.CastContextEventType || {};

      const syncCast = () => {
        if (isDisconnectingCastRef.current) return;

        const session = context.getCurrentSession?.();
        if (session) {
          castSessionRef.current = session;
          const device = session.getCastDevice?.();
          setCastDeviceName(device?.friendlyName || 'Chromecast');
          const existingMedia = session.getMediaSession?.();
          if (existingMedia) {
            setIsCasting(true);
            castMediaRef.current = existingMedia;
            if (videoRef.current && !videoRef.current.paused) {
              videoRef.current.pause();
            }
          } else if (!isConnectingCastRef.current && !isCasting) {
            void handleStartCast();
          }
        } else if (isCasting) {
          restoreLocalFromCast();
        }
      };

      context.addEventListener?.(eventTypes.SESSION_STATE_CHANGED, syncCast);
      context.addEventListener?.(eventTypes.CAST_STATE_CHANGED, syncCast);
      cleanupEvents = () => {
        context.removeEventListener?.(eventTypes.SESSION_STATE_CHANGED, syncCast);
        context.removeEventListener?.(eventTypes.CAST_STATE_CHANGED, syncCast);
      };
      syncCast();
    });

    return () => {
      unsubscribe();
      cleanupEvents();
    };
  }, [currentFileIdx, isCasting, restoreLocalFromCast]);

  const streamUrl = `/api/torrent/stream/${status.infoHash}/${currentFileIdx}${forceTranscode ? '?transcode=1' : ''}`;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowleft':
          e.preventDefault();
          seekBy(-10);
          break;
        case 'arrowright':
          e.preventDefault();
          seekBy(10);
          break;
        case 'arrowup':
          e.preventDefault();
          changeVolume(0.1);
          break;
        case 'arrowdown':
          e.preventDefault();
          changeVolume(-0.1);
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'n':
          if (nextParsedEp) {
            e.preventDefault();
            handlePlayNextEpisode();
          }
          break;
        case 'p':
          if (prevParsedEp) {
            e.preventDefault();
            handlePlayPrevEpisode();
          }
          break;
        case 'escape':
          if (isFullscreen) {
            document.exitFullscreen?.().catch(() => {});
          } else {
            handleClose();
          }
          break;
      }
      handleUserActivity();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, currentTime, duration, volume, isMuted, isFullscreen, nextParsedEp, prevParsedEp]);

  // Fullscreen sync
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const seekBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(video.currentTime + seconds, duration || video.duration || 0));
    video.currentTime = target;
    setCurrentTime(target);
  };

  const changeVolume = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const newVol = Math.max(0, Math.min(1, volume + delta));
    video.volume = newVol;
    setVolume(newVol);
    if (newVol > 0 && isMuted) {
      setIsMuted(false);
      video.muted = false;
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !isMuted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {}
  };

  const handleClose = () => {
    if (videoRef.current) {
      saveProgress(videoRef.current.currentTime, videoRef.current.duration);
      videoRef.current.pause();
    }
    onClose();
  };

  // Subtitle sync calculation
  useEffect(() => {
    if (selectedSubIdx < 0 || !subtitles[selectedSubIdx]) {
      setCurrentSubText('');
      return;
    }

    const currentSub = subtitles[selectedSubIdx];
    const adjustedTime = currentTime - subOffsetSeconds;
    const activeCue = currentSub.cues.find(
      (cue) => adjustedTime >= cue.start && adjustedTime <= cue.end
    );

    setCurrentSubText(activeCue ? activeCue.text : '');
  }, [currentTime, selectedSubIdx, subtitles, subOffsetSeconds]);

  // Subtitle file import
  const handleSubtitleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const cues = parseSrtOrVtt(text);
        if (cues.length > 0) {
          const newSub = { name: file.name, cues };
          setSubtitles((prev) => [...prev, newSub]);
          setSelectedSubIdx(subtitles.length);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (['.srt', '.vtt', '.ass', '.ssa'].includes(ext)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (text) {
          const cues = parseSrtOrVtt(text);
          if (cues.length > 0) {
            setSubtitles((prev) => [...prev, { name: file.name, cues }]);
            setSelectedSubIdx(subtitles.length);
          }
        }
      };
      reader.readAsText(file);
    }
  };

  const subFontSize = {
    small: 'clamp(1.2rem, 1.4vw, 2.2rem)',
    medium: 'clamp(1.6rem, 2vw, 3.2rem)',
    large: 'clamp(2rem, 2.6vw, 4.2rem)',
  }[subSize];

  const drawerEpisodes = useMemo(() => {
    if (selectedSeasonTab === 'all') return parsedEpisodes;
    return parsedEpisodes.filter((e) => e.seasonNumber === selectedSeasonTab);
  }, [parsedEpisodes, selectedSeasonTab]);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleUserActivity}
      onClick={handleUserActivity}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden font-sans"
    >
      {/* Native Video Element */}
      <video
        ref={videoRef}
        key={streamUrl}
        src={streamUrl}
        playsInline
        autoPlay
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
          }
        }}
        onDurationChange={() => {
          if (videoRef.current && videoRef.current.duration > 0) {
            setDuration(videoRef.current.duration);
          }
        }}
        onEnded={() => {
          if (nextParsedEp) {
            handlePlayNextEpisode();
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onError={() => {
          console.warn('[TorrentPlayer] Erro no stream nativo. Ativando transcode...');
          setForceTranscode(true);
        }}
        onClick={togglePlay}
        className="w-full h-full object-contain cursor-pointer"
      />

      {/* Subtitle Overlay */}
      {currentSubText && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 pointer-events-none text-center px-4 max-w-[85%] z-20 transition-all duration-300 ${
            controlsVisible ? 'bottom-28' : 'bottom-12'
          }`}
        >
          <span
            style={{
              fontSize: subFontSize,
              lineHeight: 1.3,
              textShadow: '0 2px 8px rgba(0,0,0,0.9), 0 0 4px #000, 0 0 10px #000',
            }}
            className="font-semibold text-amber-200 tracking-wide bg-black/40 px-3 py-1 rounded-lg backdrop-blur-[2px]"
          >
            {currentSubText}
          </span>
        </div>
      )}

      {/* Buffering HUD overlay */}
      {isBuffering && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 pointer-events-none z-10 space-y-3">
          <div className="w-16 h-16 rounded-full border-4 border-red-600/30 border-t-red-600 animate-spin flex items-center justify-center">
            <Radio className="w-6 h-6 text-red-500 animate-pulse" />
          </div>
          <div className="text-center bg-black/70 px-4 py-2 rounded-xl backdrop-blur-md border border-zinc-800">
            <p className="text-sm font-semibold text-white">Carregando buffer do Torrent...</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              {status.peers} peers • {formatBytes(status.downloadSpeed)}/s
            </p>
          </div>
        </div>
      )}

      {/* Auto-Play Next Episode Floating Card (Netflix style) */}
      {nextCountdown !== null && nextParsedEp && (
        <div className="absolute right-6 bottom-24 z-30 bg-zinc-950/95 border border-zinc-700/80 rounded-2xl p-4 shadow-2xl backdrop-blur-md max-w-sm animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                Próximo Episódio em {nextCountdown}s
              </span>
              <h4 className="text-sm font-bold text-white line-clamp-1 mt-0.5">
                T{nextParsedEp.seasonNumber}:E{nextParsedEp.episodeNumber} - {nextParsedEp.cleanTitle}
              </h4>
            </div>
            <button
              onClick={() => setNextCountdown(null)}
              className="text-zinc-400 hover:text-white p-1"
              title="Cancelar avanço automático"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handlePlayNextEpisode}
              className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition shadow-md shadow-red-950/40 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Assistir Agora</span>
            </button>
            <button
              onClick={() => setNextCountdown(null)}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-xl font-medium transition cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Controls Overlay */}
      <div
        className={`absolute inset-0 flex flex-col justify-between p-6 bg-gradient-to-t from-black/90 via-transparent to-black/80 transition-opacity duration-300 pointer-events-none ${
          controlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={handleClose}
              className="p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-white border border-zinc-700/50 shadow-lg transition cursor-pointer"
              title="Voltar (Esc)"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {parsedEpisodes.length > 1 ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-600/30 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                    <Tv className="w-3 h-3" /> Série Torrent
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-600 text-white">
                    Torrent
                  </span>
                )}
                <h1 className="text-base font-bold text-white line-clamp-1">
                  {media?.title || status.name}
                </h1>
              </div>

              {currentParsedEp && (
                <p className="text-xs text-zinc-300 line-clamp-1 mt-0.5 flex items-center gap-2">
                  <span className="font-semibold text-amber-400">
                    T{currentParsedEp.seasonNumber < 10 ? `0${currentParsedEp.seasonNumber}` : currentParsedEp.seasonNumber}:E{currentParsedEp.episodeNumber < 10 ? `0${currentParsedEp.episodeNumber}` : currentParsedEp.episodeNumber}
                  </span>
                  <span>•</span>
                  <span>{currentParsedEp.cleanTitle}</span>
                  <span className="text-zinc-500">({formatBytes(currentParsedEp.length)})</span>
                </p>
              )}
            </div>
          </div>

          {/* Right Top Actions */}
          <div className="flex items-center gap-2.5">
            {/* Real-time HUD badge */}
            <div className="flex items-center gap-3 bg-zinc-900/90 border border-zinc-700/60 px-3.5 py-1.5 rounded-xl text-xs text-zinc-300 shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-1.5" title="Peers conectados">
                <Users className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-medium">{status.peers}</span>
              </div>
              <div className="w-px h-3 bg-zinc-700" />
              <div className="flex items-center gap-1.5" title="Velocidade de download">
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-medium">{formatBytes(status.downloadSpeed)}/s</span>
              </div>
            </div>

            {/* Cast Button */}
            {castAvailable && (
              <button
                onClick={handleStartCast}
                disabled={isCastLoading}
                className={`p-2.5 rounded-xl border transition flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${
                  isCasting
                    ? 'bg-amber-600 border-amber-500 text-white'
                    : 'bg-zinc-900/80 border-zinc-700 hover:bg-zinc-800 text-zinc-300'
                }`}
                title={isCasting ? `Transmitindo para ${castDeviceName || 'Chromecast'}` : 'Transmitir para TV'}
              >
                {isCastLoading ? <Loader2 className="w-4 h-4 animate-spin text-amber-400" /> : <CastIcon className="w-4 h-4" />}
                <span>{isCasting ? castDeviceName || 'Casting' : 'Cast'}</span>
              </button>
            )}

            {/* Episodes Drawer Trigger (if Series) */}
            {parsedEpisodes.length > 1 && (
              <button
                onClick={() => setShowEpisodesDrawer((v) => !v)}
                className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  showEpisodesDrawer
                    ? 'bg-red-600 border-red-500 text-white'
                    : 'bg-zinc-900/90 hover:bg-zinc-800 border-zinc-700/80 text-white'
                }`}
              >
                <List className="w-4 h-4" />
                <span>Episódios ({parsedEpisodes.length})</span>
              </button>
            )}
          </div>
        </div>

        {/* Center Indicator Area */}
        <div className="self-center" />

        {/* Bottom Control Bar */}
        <div className="space-y-3 pointer-events-auto">
          {/* Progress / Scrub Bar */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-zinc-400 tabular-nums w-12 text-right">
              {formatTime(currentTime)}
            </span>

            <div className="relative flex-1 group py-2 cursor-pointer">
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => {
                  const target = parseFloat(e.target.value);
                  setCurrentTime(target);
                  if (videoRef.current) {
                    videoRef.current.currentTime = target;
                  }
                }}
                className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-red-600 focus:outline-none group-hover:h-2 transition-all"
              />
            </div>

            <span className="text-xs font-medium text-zinc-400 tabular-nums w-12">
              {formatTime(duration)}
            </span>
          </div>

          {/* Buttons Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Previous Episode */}
              {prevParsedEp && (
                <button
                  onClick={handlePlayPrevEpisode}
                  className="p-2 text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800/60 transition cursor-pointer"
                  title={`Episódio Anterior (P): ${prevParsedEp.cleanTitle}`}
                >
                  <SkipBack className="w-5 h-5" />
                </button>
              )}

              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="p-3 bg-white text-black hover:bg-zinc-200 rounded-full shadow-lg transition cursor-pointer"
                title="Reproduzir/Pausar (Espaço)"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>

              {/* Seek -10s */}
              <button
                onClick={() => seekBy(-10)}
                className="p-2 text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800/60 transition cursor-pointer"
                title="Voltar 10s (Seta Esquerda)"
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              {/* Seek +10s */}
              <button
                onClick={() => seekBy(10)}
                className="p-2 text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800/60 transition cursor-pointer"
                title="Avançar 10s (Seta Direita)"
              >
                <RotateCw className="w-5 h-5" />
              </button>

              {/* Next Episode */}
              {nextParsedEp && (
                <button
                  onClick={handlePlayNextEpisode}
                  className="p-2 text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800/60 transition flex items-center gap-1 text-xs cursor-pointer"
                  title={`Próximo Episódio (N): ${nextParsedEp.cleanTitle}`}
                >
                  <SkipForward className="w-5 h-5" />
                </button>
              )}

              {/* Volume Slider */}
              <div className="flex items-center gap-2 group/vol ml-2">
                <button
                  onClick={toggleMute}
                  className="p-2 text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800/60 transition cursor-pointer"
                  title="Silenciar (M)"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const nextV = parseFloat(e.target.value);
                    setVolume(nextV);
                    setIsMuted(nextV === 0);
                    if (videoRef.current) {
                      videoRef.current.volume = nextV;
                      videoRef.current.muted = nextV === 0;
                    }
                  }}
                  className="w-16 h-1 bg-zinc-700 rounded-full appearance-none accent-white cursor-pointer group-hover/vol:w-24 transition-all"
                />
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-3">
              {/* Subtitles Button & Popover */}
              <div className="relative">
                <button
                  onClick={() => setShowSubModal((v) => !v)}
                  className={`p-2 rounded-lg border transition cursor-pointer ${
                    selectedSubIdx >= 0
                      ? 'bg-red-600 border-red-500 text-white'
                      : 'text-zinc-300 hover:text-white border-zinc-700 hover:bg-zinc-800/60'
                  }`}
                  title="Legendas"
                >
                  <Subtitles className="w-5 h-5" />
                </button>

                {showSubModal && (
                  <div className="absolute right-0 bottom-12 w-72 bg-zinc-950/95 border border-zinc-800 rounded-2xl p-4 shadow-2xl backdrop-blur-md space-y-4 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Legendas</h4>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-2 py-1 bg-red-600 hover:bg-red-700 text-[10px] font-semibold text-white rounded-lg flex items-center gap-1 transition cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Carregar .srt</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".srt,.vtt,.ass,.ssa"
                        onChange={handleSubtitleFileUpload}
                        className="hidden"
                      />
                    </div>

                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      <button
                        onClick={() => setSelectedSubIdx(-1)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition cursor-pointer ${
                          selectedSubIdx === -1
                            ? 'bg-zinc-800 text-white font-medium'
                            : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                        }`}
                      >
                        <span>Desativada</span>
                        {selectedSubIdx === -1 && <Check className="w-3.5 h-3.5 text-red-500" />}
                      </button>

                      {subtitles.map((sub, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedSubIdx(idx)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition cursor-pointer ${
                            selectedSubIdx === idx
                              ? 'bg-zinc-800 text-white font-medium'
                              : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                          }`}
                        >
                          <span className="truncate pr-2">{sub.name}</span>
                          {selectedSubIdx === idx && <Check className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                        </button>
                      ))}
                    </div>

                    {selectedSubIdx >= 0 && (
                      <div className="pt-2 border-t border-zinc-800 space-y-2">
                        <label className="text-[11px] text-zinc-400">Tamanho da Legenda:</label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {(['small', 'medium', 'large'] as const).map((size) => (
                            <button
                              key={size}
                              onClick={() => setSubSize(size)}
                              className={`py-1 text-[10px] rounded-md font-medium capitalize transition cursor-pointer ${
                                subSize === size
                                  ? 'bg-red-600 text-white'
                                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                              }`}
                            >
                              {size === 'small' ? 'Pequena' : size === 'medium' ? 'Média' : 'Grande'}
                            </button>
                          ))}
                        </div>

                        <div className="pt-2 space-y-1">
                          <div className="flex justify-between text-[11px] text-zinc-400">
                            <span>Sincronia:</span>
                            <span className="font-mono text-zinc-300">{subOffsetSeconds.toFixed(1)}s</span>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setSubOffsetSeconds((v) => v - 0.5)}
                              className="flex-1 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs rounded"
                            >
                              -0.5s
                            </button>
                            <button
                              onClick={() => setSubOffsetSeconds(0)}
                              className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-xs rounded"
                            >
                              Reset
                            </button>
                            <button
                              onClick={() => setSubOffsetSeconds((v) => v + 0.5)}
                              className="flex-1 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs rounded"
                            >
                              +0.5s
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Fullscreen Button */}
              <button
                onClick={toggleFullscreen}
                className="p-2 text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800/60 transition cursor-pointer"
                title="Tela Cheia (F)"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Episodes Drawer for Torrent Series */}
      {showEpisodesDrawer && parsedEpisodes.length > 1 && (
        <div className="absolute right-6 top-20 w-88 max-w-[90vw] bg-zinc-950/95 border border-zinc-700/90 rounded-2xl p-4 shadow-2xl backdrop-blur-md z-40 space-y-3 animate-in slide-in-from-right-5 duration-150">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Tv className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Episódios da Série ({parsedEpisodes.length})
              </h3>
            </div>
            <button
              onClick={() => setShowEpisodesDrawer(false)}
              className="text-zinc-400 hover:text-white text-xs cursor-pointer p-1"
            >
              Fechar
            </button>
          </div>

          {/* Season tabs inside drawer */}
          {availableSeasons.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedSeasonTab('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition cursor-pointer ${
                  selectedSeasonTab === 'all'
                    ? 'bg-red-600 text-white'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-white'
                }`}
              >
                Todas
              </button>
              {availableSeasons.map((seasonNum) => (
                <button
                  key={seasonNum}
                  onClick={() => setSelectedSeasonTab(seasonNum)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition cursor-pointer ${
                    selectedSeasonTab === seasonNum
                      ? 'bg-red-600 text-white'
                      : 'bg-zinc-800/80 text-zinc-400 hover:text-white'
                  }`}
                >
                  T{seasonNum}
                </button>
              ))}
            </div>
          )}

          {/* List of episodes */}
          <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
            {drawerEpisodes.map((ep) => {
              const isSelected =
                (ep.infoHash?.toLowerCase() === status.infoHash.toLowerCase() && ep.fileIndex === currentFileIdx) ||
                (ep.fileIndex === currentFileIdx && (!ep.infoHash || ep.infoHash.toLowerCase() === status.infoHash.toLowerCase()));
              return (
                <button
                  key={`${ep.infoHash || 'cur'}_${ep.fileIndex}_${ep.seasonNumber}_${ep.episodeNumber}`}
                  onClick={() => handleSwitchEpisode(ep.fileIndex, ep)}
                  className={`w-full text-left p-2.5 rounded-xl text-xs flex items-center justify-between transition cursor-pointer border ${
                    isSelected
                      ? 'bg-red-600 border-red-500 text-white font-semibold shadow-md shadow-red-950/60'
                      : 'bg-zinc-900/70 hover:bg-zinc-900 border-transparent text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate min-w-0 pr-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold flex-shrink-0 ${
                      isSelected ? 'bg-black/40 text-white' : 'bg-zinc-800 text-zinc-300'
                    }`}>
                      T{ep.seasonNumber < 10 ? `0${ep.seasonNumber}` : ep.seasonNumber}:E{ep.episodeNumber < 10 ? `0${ep.episodeNumber}` : ep.episodeNumber}
                    </span>
                    <span className="truncate">{ep.cleanTitle}</span>
                  </div>
                  <span className="text-[10px] opacity-75 flex-shrink-0 font-mono">
                    {formatBytes(ep.length)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
