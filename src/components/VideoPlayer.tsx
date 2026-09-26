import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Cast as CastIcon,
  Maximize,
  Minimize,
  Subtitles,
  SkipForward,
  SkipBack,
  Settings,
  AlertTriangle,
  Loader2,
  Download,
} from 'lucide-react';
import {
  MediaItem,
  Episode,
  AudioTrackInfo,
  SubtitleTrackInfo,
} from '../types';
import { formatTime } from '../utils';
import {
  getCastContext,
  getCastErrorMessage,
  resolveCastBaseUrls,
  subscribeToCastAvailability,
} from '../cast';

interface VideoPlayerProps {
  media: MediaItem;
  episode: Episode;
  onClose: () => void;
  onPlayNextEpisode?: () => void;
  nextEpisode?: Episode;
  onPlayPrevEpisode?: () => void;
  prevEpisode?: Episode;
}

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

function parseSubtitleTime(value: string): number {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0]) || 0;
}

function parseWebVtt(text: string): SubtitleCue[] {
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

function getCastCustomData(media: any): Record<string, any> {
  const customData = media?.media?.customData ?? media?.customData;
  if (customData && typeof customData === 'object') return customData;
  if (typeof customData === 'string') {
    try {
      const parsed = JSON.parse(customData);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return {};
}

function createCastTextTrackStyle(mediaApi: any): any | undefined {
  if (typeof mediaApi?.TextTrackStyle !== 'function') return undefined;

  const style = new mediaApi.TextTrackStyle();
  // Explicitly set visible colors and an outline. Some Default Media Receiver
  // versions expose CC controls but otherwise render the track transparent.
  style.foregroundColor = '#FFFFFFFF';
  style.backgroundColor = '#000000B3';
  style.edgeType = mediaApi.TextTrackEdgeType?.OUTLINE || 'OUTLINE';
  style.edgeColor = '#000000FF';
  style.fontScale = 1.0;
  style.fontGenericFamily =
    mediaApi.TextTrackFontGenericFamily?.SANS_SERIF || 'SANS_SERIF';
  style.fontStyle = mediaApi.TextTrackFontStyle?.NORMAL || 'NORMAL';
  style.windowType = mediaApi.TextTrackWindowType?.NONE || 'NONE';
  return style;
}

type SubtitleSize = 'small' | 'medium' | 'large';

const SUBTITLE_SIZE_STORAGE_KEY = 'cinelocal-subtitle-size';
const SUBTITLE_SIZE_EVENT = 'cinelocal-subtitle-size-change';
const SUBTITLE_SIZE_LABELS: Record<SubtitleSize, string> = {
  small: 'Pequena',
  medium: 'Média',
  large: 'Grande',
};
const SUBTITLE_SIZE_FONT_SIZES: Record<SubtitleSize, string> = {
  // Use viewport-relative sizing so a 4K TV does not receive the same tiny
  // 20px subtitle that a laptop does. The limits keep it readable on both.
  small: 'clamp(1.5rem, 1.5vw, 3rem)',
  medium: 'clamp(1.75rem, 2vw, 4rem)',
  large: 'clamp(2rem, 2.5vw, 5rem)',
};

function isSubtitleSize(value: unknown): value is SubtitleSize {
  return value === 'small' || value === 'medium' || value === 'large';
}

function getSavedSubtitleSize(): SubtitleSize {
  if (typeof window === 'undefined') return 'medium';

  try {
    const savedSize = window.localStorage.getItem(SUBTITLE_SIZE_STORAGE_KEY);
    return isSubtitleSize(savedSize) ? savedSize : 'medium';
  } catch {
    return 'medium';
  }
}

function saveSubtitleSize(size: SubtitleSize) {
  try {
    window.localStorage.setItem(SUBTITLE_SIZE_STORAGE_KEY, size);
  } catch {
    // Keep the current-page setting usable when storage is blocked.
  }
  window.dispatchEvent(
    new CustomEvent<SubtitleSize>(SUBTITLE_SIZE_EVENT, { detail: size }),
  );
}

const SubtitleOverlay: React.FC<{
  text: string;
  isCasting: boolean;
  controlsVisible: boolean;
}> = ({ text, isCasting, controlsVisible }) => {
  const [subtitleSize, setSubtitleSize] =
    useState<SubtitleSize>(getSavedSubtitleSize);

  useEffect(() => {
    const handleSubtitleSizeChange = (event: Event) => {
      const nextSize = (event as CustomEvent<SubtitleSize>).detail;
      if (isSubtitleSize(nextSize)) setSubtitleSize(nextSize);
    };

    window.addEventListener(SUBTITLE_SIZE_EVENT, handleSubtitleSizeChange);
    return () =>
      window.removeEventListener(SUBTITLE_SIZE_EVENT, handleSubtitleSizeChange);
  }, []);

  if (!text || isCasting) return null;

  return (
    <div
      id="player-subtitle-overlay"
      className={`absolute left-1/2 z-50 w-[min(92vw,90rem)] -translate-x-1/2 text-center font-semibold leading-tight text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.95)] pointer-events-none transition-[bottom] duration-300 ${
        controlsVisible ? 'bottom-20 sm:bottom-24' : 'bottom-8 sm:bottom-12'
      }`}
      style={{ fontSize: SUBTITLE_SIZE_FONT_SIZES[subtitleSize] }}
      aria-live="polite"
    >
      {text.split('\n').map((line, index) => (
        <div key={`subtitle-line-${index}`}>{line}</div>
      ))}
    </div>
  );
};

interface SubtitleSizeSettingsProps {
  subtitleOffsetSeconds: number;
  onSubtitleOffsetChange: (offset: number) => void;
}

const SubtitleSizeSettings: React.FC<SubtitleSizeSettingsProps> = ({
  subtitleOffsetSeconds,
  onSubtitleOffsetChange,
}) => {
  const [subtitleSize, setSubtitleSize] =
    useState<SubtitleSize>(getSavedSubtitleSize);

  useEffect(() => {
    const handleSubtitleSizeChange = (event: Event) => {
      const nextSize = (event as CustomEvent<SubtitleSize>).detail;
      if (isSubtitleSize(nextSize)) setSubtitleSize(nextSize);
    };

    window.addEventListener(SUBTITLE_SIZE_EVENT, handleSubtitleSizeChange);
    return () =>
      window.removeEventListener(SUBTITLE_SIZE_EVENT, handleSubtitleSizeChange);
  }, []);

  return (
    <div className="mt-4 border-t border-neutral-700 pt-3">
      <h4 className="font-bold text-white text-xs uppercase tracking-wider mb-2">
        Tamanho da legenda
      </h4>
      <div className="grid grid-cols-3 gap-1">
        {(Object.keys(SUBTITLE_SIZE_LABELS) as SubtitleSize[]).map((size) => (
          <button
            key={size}
            onClick={() => {
              setSubtitleSize(size);
              saveSubtitleSize(size);
            }}
            className={`px-2 py-1.5 rounded text-xs transition-colors ${
              subtitleSize === size
                ? 'bg-[#E50914] text-white font-semibold'
                : 'hover:bg-neutral-700 text-neutral-300'
            }`}
          >
            {SUBTITLE_SIZE_LABELS[size]}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-bold text-white text-xs uppercase tracking-wider">
            Sincronização
          </h4>
          <span className="text-[11px] text-neutral-400">
            {subtitleOffsetSeconds > 0 ? '+' : ''}
            {subtitleOffsetSeconds}s
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {[-5, -1, 1, 5].map((adjustment) => (
            <button
              key={adjustment}
              type="button"
              onClick={() =>
                onSubtitleOffsetChange(subtitleOffsetSeconds + adjustment)
              }
              className="px-1 py-1.5 rounded text-xs text-neutral-300 hover:bg-neutral-700 transition-colors"
              title={`${adjustment > 0 ? 'Atrasar' : 'Adiantar'} legenda em ${Math.abs(adjustment)}s`}
            >
              {adjustment > 0 ? '+' : ''}
              {adjustment}s
            </button>
          ))}
          <button
            type="button"
            onClick={() => onSubtitleOffsetChange(0)}
            className={`px-1 py-1.5 rounded text-xs transition-colors ${
              subtitleOffsetSeconds === 0
                ? 'bg-neutral-700 text-white font-semibold'
                : 'text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            Resetar
          </button>
        </div>
      </div>
    </div>
  );
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  media,
  episode,
  onClose,
  onPlayNextEpisode,
  nextEpisode,
  onPlayPrevEpisode,
  prevEpisode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const hideControlsTimer = useRef<any>(null);
  const progressSaveTimer = useRef<any>(null);
  const saveProgressDebounceTimer = useRef<any>(null);
  const isSeekingRef = useRef<boolean>(false);
  const pendingReloadPositionRef = useRef<number | null>(null);
  const resumeAfterReloadRef = useRef<boolean>(true);
  const hlsStreamOffsetRef = useRef<number>(0);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(
    episode.durationSeconds || 0,
  );
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);

  // Audio & Subtitle Tracks
  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number>(
    episode.selectedAudioIndex !== undefined ? episode.selectedAudioIndex : 0,
  );
  const selectedAudioIndexRef = useRef<number>(
    episode.selectedAudioIndex !== undefined ? episode.selectedAudioIndex : 0,
  );
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number>(
    episode.selectedSubtitleIndex !== undefined
      ? episode.selectedSubtitleIndex
      : -1, // -1 = off
  );
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [activeSubtitleText, setActiveSubtitleText] = useState<string>('');
  const [subtitleOffsetSeconds, setSubtitleOffsetSeconds] = useState<number>(0);
  const [showAudioSubModal, setShowAudioSubModal] = useState<boolean>(false);

  // Next Episode Auto-Countdown
  const [showNextCountdown, setShowNextCountdown] = useState<boolean>(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(5);
  const countdownInterval = useRef<any>(null);

  // Recovery & Transcode Fallback States
  const [isForceTranscode, setIsForceTranscode] = useState<boolean>(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isRecovering, setIsRecovering] = useState<boolean>(false);
  const [isInstallingFfmpeg, setIsInstallingFfmpeg] = useState<boolean>(false);
  const [installFfmpegMsg, setInstallFfmpegMsg] = useState<string | null>(null);
  const [hlsReloadVersion, setHlsReloadVersion] = useState<number>(0);
  const [castAvailable, setCastAvailable] = useState<boolean>(false);
  const [isCasting, setIsCasting] = useState<boolean>(false);
  const [isCastLoading, setIsCastLoading] = useState<boolean>(false);
  const [castDeviceName, setCastDeviceName] = useState<string | null>(null);
  const [castError, setCastError] = useState<string | null>(null);

  const hlsRef = useRef<Hls | null>(null);
  const castContextRef = useRef<any>(null);
  const castSessionRef = useRef<any>(null);
  const castMediaRef = useRef<any>(null);
  const castMediaListenerRef = useRef<((isAlive: boolean) => void) | null>(
    null,
  );
  const castStartTimeRef = useRef<number>(0);
  const castCurrentTimeRef = useRef<number>(0);
  const castStreamOffsetRef = useRef<number>(0);
  const castLastProgressSaveRef = useRef<number>(0);
  const castActiveRef = useRef<boolean>(false);
  const castWasPlayingRef = useRef<boolean>(false);
  const castLastLoadedEpisodeIdRef = useRef<string | null>(null);
  const isDirectMP4 =
    episode.extension === '.mp4' || episode.extension === '.webm';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isAndroidMobile = /Android/i.test(userAgent);
  const isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent);
  const showCastButton = castAvailable || isAndroidMobile || isAppleMobile;
  const getLocalPlaybackTime = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.currentTime)) return currentTime;
    return Math.max(0, hlsStreamOffsetRef.current + video.currentTime);
  };

  // Save progress helper (debounced to avoid thrashing server and disk)
  const saveProgress = useCallback(
    (
      timeSec: number,
      totalDur?: number,
      completed?: boolean,
      immediate = false,
      audioIndexOverride?: number,
      subtitleIndexOverride?: number,
    ) => {
      if (timeSec < 0 || isNaN(timeSec)) return;

      const performSave = () => {
        const payload = {
          mediaId: media.id,
          episodeId: episode.id,
          progressSeconds: Math.floor(timeSec),
          durationSeconds: totalDur || duration,
          completed: completed,
          audioIndex: audioIndexOverride ?? selectedAudioIndexRef.current,
          subtitleIndex: subtitleIndexOverride ?? selectedSubtitleIndex,
        };

        try {
          fetch('/api/library/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch((err) => console.error('Error saving progress:', err));
        } catch (e) {
          console.error('Error saving progress:', e);
        }
      };

      if (saveProgressDebounceTimer.current) {
        clearTimeout(saveProgressDebounceTimer.current);
        saveProgressDebounceTimer.current = null;
      }

      if (immediate || completed) {
        performSave();
      } else {
        saveProgressDebounceTimer.current = setTimeout(performSave, 1500);
      }
    },
    [media.id, episode.id, duration, selectedAudioIndex, selectedSubtitleIndex],
  );

  const isConnectingCastRef = useRef<boolean>(false);
  const isDisconnectingCastRef = useRef<boolean>(false);

  const persistPlaybackState = useCallback(
    (timeOverride?: number, completed = false) => {
      const position =
        typeof timeOverride === 'number'
          ? timeOverride
          : getLocalPlaybackTime();
      saveProgress(
        position,
        duration,
        completed,
        true,
        selectedAudioIndexRef.current,
        selectedSubtitleIndex,
      );
    },
    [duration, getLocalPlaybackTime, saveProgress, selectedSubtitleIndex],
  );

  const getAbsolutePositionFromCast = useCallback(
    (estimatedTime: number | null | undefined): number => {
      const offset =
        castStartTimeRef.current || castStreamOffsetRef.current || 0;
      if (
        typeof estimatedTime !== 'number' ||
        !Number.isFinite(estimatedTime) ||
        estimatedTime < 0
      ) {
        return castCurrentTimeRef.current > 0
          ? castCurrentTimeRef.current
          : Math.max(0, offset);
      }
      if (offset > 0) {
        // If estimatedTime is less than offset, it is definitely relative to the Chromecast start
        if (estimatedTime < offset) {
          return Math.max(0, offset + estimatedTime);
        }
        // If estimatedTime >= offset:
        // Check whether estimatedTime is already the absolute timeline position
        // (very close to castCurrentTimeRef.current) or if it's relative elapsed duration
        if (
          castCurrentTimeRef.current > offset &&
          Math.abs(estimatedTime - castCurrentTimeRef.current) < 15
        ) {
          return Math.max(0, estimatedTime);
        }
        return Math.max(0, offset + estimatedTime);
      }
      return Math.max(0, estimatedTime);
    },
    [],
  );

  const registerCastMedia = useCallback(
    (session: any) => {
      const media = session?.getMediaSession?.();
      if (!media || media === castMediaRef.current) return;

      if (castMediaRef.current && castMediaListenerRef.current) {
        castMediaRef.current.removeUpdateListener?.(
          castMediaListenerRef.current,
        );
      }

      const updateListener = () => {
        const estimatedTime = media.getEstimatedTime?.();
        if (
          typeof estimatedTime !== 'number' ||
          !Number.isFinite(estimatedTime)
        )
          return;

        const absoluteTime = getAbsolutePositionFromCast(estimatedTime);
        castCurrentTimeRef.current = absoluteTime;
        setCurrentTime(absoluteTime);

        if (
          media.playerState === 'PLAYING' ||
          media.playerState === 'BUFFERING'
        ) {
          setIsPlaying(true);
        } else if (
          media.playerState === 'PAUSED' ||
          media.playerState === 'IDLE'
        ) {
          setIsPlaying(false);
        }

        const now = Date.now();
        if (now - castLastProgressSaveRef.current >= 8000) {
          castLastProgressSaveRef.current = now;
          saveProgress(absoluteTime, duration, false, true);
        }
      };

      castMediaRef.current = media;
      castMediaListenerRef.current = updateListener;
      media.addUpdateListener?.(updateListener);
      updateListener();
    },
    [duration, getAbsolutePositionFromCast, saveProgress],
  );

  const waitForCastMediaSession = useCallback(
    async (session: any): Promise<any | null> => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const remoteMedia = session?.getMediaSession?.();
        if (remoteMedia) {
          return remoteMedia;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    },
    [],
  );

  const restoreLocalAfterCast = useCallback(() => {
    const position = Math.max(0, castCurrentTimeRef.current);
    const video = videoRef.current;
    const shouldResumeLocalPlayback = castWasPlayingRef.current;
    const targetIsDirectMP4 =
      episode.extension === '.mp4' || episode.extension === '.webm';
    const shouldUseHls =
      !targetIsDirectMP4 ||
      isForceTranscode ||
      (selectedAudioIndexRef.current || 0) > 0;

    // Immediately persist the absolute progress to the library database so no progress is lost
    saveProgress(position, duration, false, true);

    if (shouldUseHls) {
      // Recreate the local HLS session directly from the absolute position
      // where Chromecast stopped.
      pendingReloadPositionRef.current = position;
      resumeAfterReloadRef.current = shouldResumeLocalPlayback;
      setCurrentTime(position);
      setHlsReloadVersion((version) => version + 1);
    } else if (video && Number.isFinite(position)) {
      try {
        video.currentTime = position;
        setCurrentTime(position);
      } catch {}
      if (shouldResumeLocalPlayback) {
        video.play().catch(() => {});
      }
    }

    if (castMediaRef.current && castMediaListenerRef.current) {
      castMediaRef.current.removeUpdateListener?.(castMediaListenerRef.current);
    }
    castMediaRef.current = null;
    castMediaListenerRef.current = null;
    castSessionRef.current = null;
    castActiveRef.current = false;
    castStreamOffsetRef.current = 0;
    castStartTimeRef.current = 0;
    castLastLoadedEpisodeIdRef.current = null;
    setIsCasting(false);
    setCastDeviceName(null);
  }, [duration, episode.extension, isForceTranscode, saveProgress]);

  const disconnectCast = useCallback(async () => {
    if (isDisconnectingCastRef.current) return;
    isDisconnectingCastRef.current = true;
    setIsCastLoading(true);

    try {
      const context = castContextRef.current || getCastContext();
      const session = castSessionRef.current || context?.getCurrentSession?.();
      const remoteMedia = castMediaRef.current || session?.getMediaSession?.();
      const estimatedTime = remoteMedia?.getEstimatedTime?.();

      if (typeof estimatedTime === 'number' && Number.isFinite(estimatedTime)) {
        const absolutePosition = getAbsolutePositionFromCast(estimatedTime);
        castCurrentTimeRef.current = absolutePosition;
        setCurrentTime(absolutePosition);
      }

      if (remoteMedia?.playerState) {
        castWasPlayingRef.current =
          remoteMedia.playerState === 'PLAYING' ||
          remoteMedia.playerState === 'BUFFERING';
      }

      restoreLocalAfterCast();

      try {
        if (typeof session?.endSession === 'function') {
          await session.endSession(true);
        } else if (typeof context?.endCurrentSession === 'function') {
          await context.endCurrentSession(true);
        }
      } catch {
        // Local playback has already been restored; a receiver-side disconnect
        // failure should not leave the player locked in Cast mode.
      }
    } finally {
      setIsCastLoading(false);
      isDisconnectingCastRef.current = false;
    }
  }, [getAbsolutePositionFromCast, restoreLocalAfterCast]);

  const loadMediaToCastSession = useCallback(
    async (
      session: any,
      targetMedia: MediaItem = media,
      targetEpisode: Episode = episode,
      targetAudioIndex = targetEpisode.id === episode.id
        ? selectedAudioIndexRef.current
        : (targetEpisode.selectedAudioIndex ?? 0),
      requestedPosition?: number,
      requestedAutoplay?: boolean,
    ): Promise<boolean> => {
      if (!session) return false;

      const video = videoRef.current;
      const position =
        requestedPosition ??
        (isCasting ? castCurrentTimeRef.current : getLocalPlaybackTime());
      const wasPlaying =
        requestedAutoplay ?? (isCasting ? isPlaying : !!video && !video.paused);

      // Immediately pause local video to freeze local playback and prevent double audio
      if (video && !video.paused) {
        try {
          video.pause();
        } catch {}
      }

      const targetIsDirectMP4 =
        targetEpisode.extension === '.mp4' ||
        targetEpisode.extension === '.webm';
      const shouldUseHls =
        !targetIsDirectMP4 || isForceTranscode || targetAudioIndex > 0;
      const castStartOffset = shouldUseHls ? Math.max(0, position) : 0;

      castStartTimeRef.current = position;
      castStreamOffsetRef.current =
        castStartOffset > 0 ? castStartOffset : position;
      castCurrentTimeRef.current = position;
      castWasPlayingRef.current = wasPlaying;
      castSessionRef.current = session;
      castActiveRef.current = true;
      castLastProgressSaveRef.current = Date.now();
      castLastLoadedEpisodeIdRef.current = targetEpisode.id;

      const device = session.getCastDevice?.();
      setCastDeviceName(
        device?.friendlyName || device?.getFriendlyName?.() || 'Chromecast',
      );
      setIsCasting(true);

      const streamPath = shouldUseHls
        ? `/api/media/${targetMedia.id}/episode/${targetEpisode.id}/hls/master.m3u8?audio=${targetAudioIndex}&cast=1${
            castStartOffset > 0
              ? `&seek=${encodeURIComponent(castStartOffset)}`
              : ''
          }${isForceTranscode ? '&transcode=1' : ''}`
        : `/api/media/${targetMedia.id}/episode/${targetEpisode.id}/stream`;
      const contentType = shouldUseHls
        ? 'application/x-mpegURL'
        : targetEpisode.extension === '.webm'
          ? 'video/webm'
          : 'video/mp4';

      const browserWindow = window as any;
      const mediaApi = browserWindow.chrome?.cast?.media;
      if (!mediaApi) throw new Error('API do Google Cast não disponível.');

      const baseUrls = await resolveCastBaseUrls();
      let lastError: unknown = null;
      let loaded = false;

      for (const baseUrl of baseUrls) {
        try {
          const mediaInfo = new mediaApi.MediaInfo(
            `${baseUrl}${streamPath}`,
            contentType,
          );
          mediaInfo.streamType = mediaApi.StreamType.BUFFERED;
          const castTextTrackStyle = createCastTextTrackStyle(mediaApi);
          if (castTextTrackStyle) {
            mediaInfo.textTrackStyle = castTextTrackStyle;
          }

          if (shouldUseHls) {
            if (mediaApi.HlsSegmentFormat?.TS) {
              mediaInfo.hlsSegmentFormat = mediaApi.HlsSegmentFormat.TS;
            }
            if (mediaApi.HlsVideoSegmentFormat?.MPEG2_TS) {
              mediaInfo.hlsVideoSegmentFormat =
                mediaApi.HlsVideoSegmentFormat.MPEG2_TS;
            }
          }

          const metadata = new mediaApi.GenericMediaMetadata();
          metadata.title = targetMedia.title;
          metadata.subtitle =
            targetMedia.kind === 'series'
              ? `Temporada ${targetEpisode.seasonNumber} · Episódio ${targetEpisode.episodeNumber} · ${targetEpisode.title}`
              : targetEpisode.title;
          mediaInfo.metadata = metadata;
          mediaInfo.customData = {
            mediaId: targetMedia.id,
            episodeId: targetEpisode.id,
            audioIndex: targetAudioIndex,
            castStartSeconds: castStartOffset > 0 ? castStartOffset : position,
          };

          const loadRequest = new mediaApi.LoadRequest(mediaInfo);
          const targetSubtitleIndex =
            targetEpisode.id === episode.id
              ? selectedSubtitleIndex
              : (targetEpisode.selectedSubtitleIndex ?? -1);
          const targetSubtitleOffset =
            (targetEpisode.id === episode.id ? subtitleOffsetSeconds : 0) -
            castStartOffset;
          const selectedTargetSubtitle =
            targetSubtitleIndex >= 0
              ? targetEpisode.subtitleTracks[targetSubtitleIndex]
              : undefined;

          if (selectedTargetSubtitle) {
            try {
              await fetch(
                `/api/media/${targetMedia.id}/episode/${targetEpisode.id}/subtitles/${selectedTargetSubtitle.index}?offset=${encodeURIComponent(targetSubtitleOffset)}`,
              );
            } catch {}
          }

          const textTrackType = mediaApi.TrackType?.TEXT || 'TEXT';
          if (targetEpisode.subtitleTracks.length > 0) {
            mediaInfo.tracks = targetEpisode.subtitleTracks.map((track) => {
              const castTrack = new mediaApi.Track(
                track.index + 1,
                textTrackType,
              );
              const subtitleOffsetQuery =
                targetSubtitleOffset !== 0
                  ? `?offset=${encodeURIComponent(targetSubtitleOffset)}`
                  : '';
              castTrack.trackContentId = `${baseUrl}/api/media/${targetMedia.id}/episode/${targetEpisode.id}/subtitles/${track.index}${subtitleOffsetQuery}`;
              castTrack.trackContentType = 'text/vtt';
              castTrack.subtype =
                mediaApi.TextTrackType?.SUBTITLES || 'SUBTITLES';
              castTrack.name = track.title || `Legenda ${track.index + 1}`;
              castTrack.language = track.language || 'pt';
              return castTrack;
            });
            if (
              targetSubtitleIndex >= 0 &&
              mediaInfo.tracks[targetSubtitleIndex]
            ) {
              loadRequest.activeTrackIds = [
                mediaInfo.tracks[targetSubtitleIndex].trackId,
              ];
            }
          }

          loadRequest.autoplay = wasPlaying;
          loadRequest.currentTime = shouldUseHls ? 0 : position;
          await session.loadMedia(loadRequest);

          const remoteMedia = await waitForCastMediaSession(session);
          if (!remoteMedia) {
            throw new Error(
              'O Chromecast carregou a mídia, mas a sessão de controle ainda não está disponível.',
            );
          }

          const activeCastTrackId =
            targetSubtitleIndex >= 0
              ? mediaInfo.tracks?.[targetSubtitleIndex]?.trackId
              : undefined;
          if (
            mediaInfo.tracks?.length > 0 &&
            mediaApi.EditTracksInfoRequest &&
            typeof remoteMedia.editTracksInfo === 'function'
          ) {
            const editTracksRequest = new mediaApi.EditTracksInfoRequest(
              activeCastTrackId ? [activeCastTrackId] : [],
              castTextTrackStyle,
            );
            await new Promise<void>((resolve) => {
              remoteMedia.editTracksInfo(
                editTracksRequest,
                () => resolve(),
                () => resolve(),
              );
            });
          }

          if (
            !shouldUseHls &&
            position > 0 &&
            mediaApi.SeekRequest &&
            typeof remoteMedia.seek === 'function'
          ) {
            const seekRequest = new mediaApi.SeekRequest();
            seekRequest.currentTime = position;
            await new Promise<void>((resolve) => {
              remoteMedia.seek(
                seekRequest,
                () => resolve(),
                () => resolve(),
              );
            });
          }

          registerCastMedia(session);
          loaded = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!loaded) {
        throw (
          lastError ||
          new Error('O Chromecast não conseguiu carregar esta mídia.')
        );
      }

      if (video && !video.paused) {
        try {
          video.pause();
        } catch {}
      }

      return true;
    },
    [
      episode,
      isCasting,
      isForceTranscode,
      isPlaying,
      media,
      registerCastMedia,
      selectedSubtitleIndex,
      subtitleOffsetSeconds,
      waitForCastMediaSession,
    ],
  );

  const handleCast = async (
    targetMedia: MediaItem = media,
    targetEpisode: Episode = episode,
    targetAudioIndex = targetEpisode.id === episode.id
      ? selectedAudioIndexRef.current
      : (targetEpisode.selectedAudioIndex ?? 0),
    requestedPosition?: number,
    requestedAutoplay?: boolean,
    toggleConnection = true,
  ) => {
    if (toggleConnection && (isCasting || castActiveRef.current)) {
      await disconnectCast();
      return;
    }

    const context = castContextRef.current || getCastContext();
    if (!context) {
      const hostname = window.location.hostname.toLowerCase();
      const isLocalHost =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '[::1]';

      if (isAppleMobile) {
        setCastError(
          'O Chrome no iPhone/iPad não oferece suporte ao Google Cast pela web. Use o Chrome em um celular Android ou um computador compatível.',
        );
      } else if (window.location.protocol !== 'https:' && !isLocalHost) {
        setCastError(
          'No celular, o Google Cast exige HTTPS. Abra o CineLocal por um endereço HTTPS na rede local para transmitir.',
        );
      } else {
        setCastError(
          'O Google Cast não está disponível neste navegador. Use o Google Chrome e verifique se o Chromecast está na mesma rede.',
        );
      }
      return;
    }

    setCastError(null);
    setIsCastLoading(true);
    isConnectingCastRef.current = true;

    try {
      let session = context.getCurrentSession?.();
      if (!session) {
        await context.requestSession();
        session = context.getCurrentSession?.();
      }

      if (!session) {
        // User dismissed the device picker dialog without selecting a device
        setIsCastLoading(false);
        isConnectingCastRef.current = false;
        return;
      }

      await loadMediaToCastSession(
        session,
        targetMedia,
        targetEpisode,
        targetAudioIndex,
        requestedPosition,
        requestedAutoplay,
      );
    } catch (error) {
      setCastError(getCastErrorMessage(error));
      restoreLocalAfterCast();
    } finally {
      setIsCastLoading(false);
      isConnectingCastRef.current = false;
    }
  };

  // Initialize the Google Cast sender framework when the SDK becomes ready.
  useEffect(() => {
    let removeContextListeners = () => {};

    const unsubscribe = subscribeToCastAvailability((context) => {
      removeContextListeners();
      removeContextListeners = () => {};

      if (!context) {
        setCastAvailable(false);
        return;
      }

      setCastAvailable(true);
      castContextRef.current = context;
      const eventTypes =
        (window as any).cast?.framework?.CastContextEventType || {};

      const syncCastSession = () => {
        if (isDisconnectingCastRef.current) return;

        const session = context.getCurrentSession?.();
        if (session) {
          castSessionRef.current = session;
          const device = session.getCastDevice?.();
          setCastDeviceName(
            device?.friendlyName || device?.getFriendlyName?.() || 'Chromecast',
          );
          const existingRemoteMedia = session.getMediaSession?.();

          if (existingRemoteMedia) {
            castActiveRef.current = true;
            const customData = getCastCustomData(existingRemoteMedia);
            const savedCastOffset = Number(customData.castStartSeconds);
            if (Number.isFinite(savedCastOffset) && savedCastOffset >= 0) {
              castStreamOffsetRef.current = savedCastOffset;
              castStartTimeRef.current = savedCastOffset;
            }
            castLastLoadedEpisodeIdRef.current = customData.episodeId || null;
            setIsCasting(true);
            registerCastMedia(session);
            if (videoRef.current && !videoRef.current.paused) {
              videoRef.current.pause();
            }
          } else if (!isConnectingCastRef.current && !castActiveRef.current) {
            // User connected to Cast via browser menu or outside our button, auto-load immediately
            void handleCast(
              media,
              episode,
              selectedAudioIndexRef.current,
              getLocalPlaybackTime(),
              isPlaying,
              false,
            );
          }
        } else if (castActiveRef.current || isCasting) {
          const remoteMedia = castMediaRef.current;
          const estimatedTime = remoteMedia?.getEstimatedTime?.();
          if (
            typeof estimatedTime === 'number' &&
            Number.isFinite(estimatedTime)
          ) {
            const absolutePosition = getAbsolutePositionFromCast(estimatedTime);
            castCurrentTimeRef.current = absolutePosition;
            setCurrentTime(absolutePosition);
          }
          restoreLocalAfterCast();
        }
      };

      const listeners: Array<[string | undefined, () => void]> = [
        [eventTypes.CAST_STATE_CHANGED, syncCastSession],
        [eventTypes.SESSION_STATE_CHANGED, syncCastSession],
      ];

      for (const [eventName, listener] of listeners) {
        if (eventName) context.addEventListener?.(eventName, listener);
      }

      syncCastSession();
      removeContextListeners = () => {
        for (const [eventName, listener] of listeners) {
          if (eventName) context.removeEventListener?.(eventName, listener);
        }
      };
    });

    return () => {
      unsubscribe();
      removeContextListeners();
    };
  }, [
    episode,
    getAbsolutePositionFromCast,
    isPlaying,
    media,
    registerCastMedia,
    restoreLocalAfterCast,
  ]);

  useEffect(() => {
    const nextAudioIndex = episode.selectedAudioIndex ?? 0;
    setSelectedAudioIndex(nextAudioIndex);
    selectedAudioIndexRef.current = nextAudioIndex;
    setSelectedSubtitleIndex(episode.selectedSubtitleIndex ?? -1);
    setSubtitleOffsetSeconds(0);
    setDuration(episode.durationSeconds || 0);
    setCurrentTime(
      episode.progressSeconds > 10 && !episode.watched
        ? episode.progressSeconds
        : 0,
    );
    pendingReloadPositionRef.current = null;
    hlsStreamOffsetRef.current = 0;
  }, [media.id, episode.id]);

  // The sender UI remains mounted while casting, but the local video must not
  // be allowed to continue playing underneath the receiver session.
  useEffect(() => {
    if (!isCasting) return;
    const video = videoRef.current;
    if (video && !video.paused) video.pause();
  }, [isCasting]);

  // Auto-hide controls
  const handleUserActivity = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false);
        setShowAudioSubModal(false);
      }
    }, 3500);
  }, []);

  // Initialize playback (HLS engine for MKV/transcoded, native HTTP Range 206 for MP4/WebM)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const requestedSeek = pendingReloadPositionRef.current;
    pendingReloadPositionRef.current = null;
    const initialSeek =
      requestedSeek !== null
        ? requestedSeek
        : episode.progressSeconds > 10 && !episode.watched
          ? episode.progressSeconds
          : 0;
    const resumePlayback =
      requestedSeek === null || resumeAfterReloadRef.current;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const shouldUseHls =
      !isDirectMP4 || isForceTranscode || selectedAudioIndex > 0;
    const hlsStartOffset = shouldUseHls ? Math.max(0, initialSeek) : 0;
    hlsStreamOffsetRef.current = hlsStartOffset;
    if (shouldUseHls) setCurrentTime(hlsStartOffset);

    if (shouldUseHls) {
      const hlsUrl = `/api/media/${media.id}/episode/${episode.id}/hls/master.m3u8?audio=${selectedAudioIndex}${
        hlsStartOffset > 0 ? `&seek=${encodeURIComponent(hlsStartOffset)}` : ''
      }${isForceTranscode ? '&transcode=1' : ''}`;

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // MKV sources commonly have 8–12 second GOPs. Keep more media
          // queued so a slow disk/FFmpeg segment does not reach the playhead.
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          backBufferLength: 60,
          nudgeOffset: 0.1,
          nudgeMaxRetry: 5,
          manifestLoadingTimeOut: 25000,
          manifestLoadingMaxRetry: 6,
          levelLoadingTimeOut: 25000,
          levelLoadingMaxRetry: 6,
          fragLoadingTimeOut: 25000,
          fragLoadingMaxRetry: 6,
        });
        hlsRef.current = hls;

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (
            !hlsStartOffset &&
            initialSeek >= 0 &&
            (initialSeek > 0 || requestedSeek !== null)
          ) {
            try {
              video.currentTime = initialSeek;
            } catch (err) {
              console.warn('[CineLocal] Falha ao aplicar seek inicial:', err);
            }
          }
          if (resumePlayback && !castActiveRef.current) {
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
          if (
            data.details.totalduration &&
            isFinite(data.details.totalduration)
          ) {
            if (data.details.live) {
              if (!episode.durationSeconds || episode.durationSeconds <= 0) {
                setDuration((prev) =>
                  Math.max(prev, data.details.totalduration),
                );
              }
            } else if (data.details.totalduration > 0) {
              setDuration((prev) =>
                Math.max(prev, hlsStartOffset + data.details.totalduration),
              );
            }
          }
        });

        let networkErrorCount = 0;
        let lastStallRecovery = 0;
        hls.on(Hls.Events.ERROR, async (_event, data) => {
          if (
            !data.fatal &&
            data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR
          ) {
            // A segment can still be completing on disk when Hls.js reaches
            // the current buffer edge. Ask the loader to continue from the
            // current position without seeking the video or changing speed.
            const now = Date.now();
            if (now - lastStallRecovery > 1500) {
              lastStallRecovery = now;
              hls.startLoad(video.currentTime);
            }
            return;
          }

          if (data.fatal) {
            console.error(
              '[CineLocal HLS Erro Fatal]',
              data.type,
              data.details,
              data,
            );
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                networkErrorCount++;
                if (data.response?.code === 500 || networkErrorCount > 3) {
                  hls.destroy();
                  try {
                    const res = await fetch('/api/system/status');
                    const sys = await res.json();
                    if (!sys.ffmpegFound) {
                      setPlaybackError(
                        'O FFmpeg não foi encontrado no seu computador. Para reproduzir arquivos .MKV ou com múltiplos áudios, coloque o arquivo "ffmpeg.exe" dentro da pasta "bin" do aplicativo ou instale o FFmpeg no Windows.',
                      );
                      return;
                    }
                  } catch {}
                  setPlaybackError(
                    'Não foi possível inicializar o motor de reprodução do vídeo. Verifique se o arquivo existe e se o FFmpeg está instalado.',
                  );
                } else {
                  hls.startLoad();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.warn(
                  '[CineLocal HLS] Tentando recuperar erro de mídia...',
                );
                hls.recoverMediaError();
                break;
              default:
                console.error(
                  '[CineLocal HLS] Erro fatal não recuperável:',
                  data,
                );
                hls.destroy();
                if (!isForceTranscode) {
                  setIsForceTranscode(true);
                } else {
                  setPlaybackError(
                    'Não foi possível continuar a reprodução deste arquivo MKV.',
                  );
                }
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        const onLoaded = () => {
          if (
            !hlsStartOffset &&
            initialSeek >= 0 &&
            (initialSeek > 0 || requestedSeek !== null)
          ) {
            video.currentTime = initialSeek;
          }
          if (resumePlayback && !castActiveRef.current) {
            video.play().catch(() => {});
          }
        };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
      }
    } else {
      // Direct native MP4 / WebM
      const directUrl = `/api/media/${media.id}/episode/${episode.id}/stream`;
      video.src = directUrl;
      const onLoaded = () => {
        if (video.duration && isFinite(video.duration)) {
          setDuration(video.duration);
        }
        if (initialSeek > 0) {
          video.currentTime = initialSeek;
        }
        if (!castActiveRef.current) video.play().catch(() => {});
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [
    media.id,
    episode.id,
    isDirectMP4,
    isForceTranscode,
    selectedAudioIndex,
    hlsReloadVersion,
  ]);

  // Periodic progress saving (every 5 seconds)
  useEffect(() => {
    progressSaveTimer.current = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        saveProgress(getLocalPlaybackTime());
      }
    }, 5000);

    return () => {
      if (progressSaveTimer.current) clearInterval(progressSaveTimer.current);
    };
  }, [saveProgress]);

  // Save on beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (videoRef.current) {
        persistPlaybackState(
          isCasting ? castCurrentTimeRef.current : getLocalPlaybackTime(),
        );
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      handleBeforeUnload();
    };
  }, [persistPlaybackState, getLocalPlaybackTime, isCasting]);

  // Load the selected subtitle as cues rendered by CineLocal itself. Native
  // browser text tracks can disappear when a custom player enters fullscreen.
  useEffect(() => {
    let cancelled = false;

    if (
      selectedSubtitleIndex < 0 ||
      !episode.subtitleTracks[selectedSubtitleIndex]
    ) {
      setSubtitleCues([]);
      setActiveSubtitleText('');
      return () => {
        cancelled = true;
      };
    }

    const track = episode.subtitleTracks[selectedSubtitleIndex];
    fetch(
      `/api/media/${media.id}/episode/${episode.id}/subtitles/${track.index}`,
    )
      .then((response) => {
        if (!response.ok) throw new Error('Falha ao carregar a legenda');
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setSubtitleCues(parseWebVtt(text));
      })
      .catch(() => {
        if (!cancelled) setSubtitleCues([]);
      });

    return () => {
      cancelled = true;
    };
  }, [media.id, episode.id, episode.subtitleTracks, selectedSubtitleIndex]);

  useEffect(() => {
    const cue = subtitleCues.find(
      (item) =>
        currentTime >= item.start + subtitleOffsetSeconds &&
        currentTime < item.end + subtitleOffsetSeconds,
    );
    setActiveSubtitleText(cue?.text || '');
  }, [currentTime, subtitleCues, subtitleOffsetSeconds]);

  // Keep the same Cast session when the parent changes to the next/previous
  // episode. The local video component stays mounted, while the receiver gets
  // a new LOAD request for the selected episode.
  useEffect(() => {
    if (
      !isCasting ||
      !castSessionRef.current ||
      castLastLoadedEpisodeIdRef.current === episode.id
    )
      return;
    void handleCast(
      media,
      episode,
      episode.selectedAudioIndex ?? 0,
      0,
      true,
      false,
    );
  }, [episode.id, isCasting, media.id]);

  const sendCastMediaCommand = (
    methodName: 'play' | 'pause' | 'seek' | 'setVolume' | 'editTracksInfo',
    request?: any,
  ): boolean => {
    const remoteMedia = castMediaRef.current;
    const method = remoteMedia?.[methodName];
    if (!isCasting || !remoteMedia || typeof method !== 'function')
      return false;

    try {
      method.call(
        remoteMedia,
        request,
        () => {},
        (error: unknown) => setCastError(getCastErrorMessage(error)),
      );
      return true;
    } catch (error) {
      setCastError(getCastErrorMessage(error));
      return false;
    }
  };

  const setCastVolume = (level: number, muted: boolean): boolean => {
    const mediaApi = (window as any).chrome?.cast?.media;
    if (!mediaApi?.Volume || !mediaApi?.VolumeRequest) return false;
    const remoteVolume = new mediaApi.Volume();
    remoteVolume.level = level;
    remoteVolume.muted = muted;
    const request = new mediaApi.VolumeRequest(remoteVolume);
    return sendCastMediaCommand('setVolume', request);
  };

  const togglePlayback = () => {
    if (isCasting) {
      if (!castMediaRef.current) return;
      const mediaApi = (window as any).chrome?.cast?.media;
      const request = isPlaying
        ? mediaApi?.PauseRequest
          ? new mediaApi.PauseRequest()
          : undefined
        : mediaApi?.PlayRequest
          ? new mediaApi.PlayRequest()
          : undefined;
      if (sendCastMediaCommand(isPlaying ? 'pause' : 'play', request)) {
        setIsPlaying(!isPlaying);
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  // Handle switching audio tracks
  const handleSelectAudio = (index: number) => {
    if (index === selectedAudioIndex) {
      setShowAudioSubModal(false);
      return;
    }

    if (isCasting) {
      if (!castSessionRef.current) return;
      const position = castCurrentTimeRef.current;
      setSelectedAudioIndex(index);
      selectedAudioIndexRef.current = index;
      setShowAudioSubModal(false);
      saveProgress(
        position,
        duration,
        false,
        true,
        index,
        selectedSubtitleIndex,
      );
      void handleCast(media, episode, index, position, isPlaying, false);
      return;
    }

    const video = videoRef.current;
    const position = getLocalPlaybackTime();
    pendingReloadPositionRef.current = Math.max(0, position || 0);
    resumeAfterReloadRef.current = !!video && !video.paused;
    // onPause can fire synchronously below. Make that save use the newly
    // selected track instead of racing the explicit save after setState.
    selectedAudioIndexRef.current = index;

    // Stop the old HLS pipeline before creating the new one, but keep the
    // exact playback position for the replacement stream.
    if (video && !video.paused) {
      video.pause();
    }

    setSelectedAudioIndex(index);
    setShowAudioSubModal(false);
    saveProgress(
      Math.max(0, position || 0),
      duration,
      false,
      true,
      index,
      selectedSubtitleIndex,
    );
  };

  const handleSelectSubtitle = (index: number) => {
    setSelectedSubtitleIndex(index);
    setSubtitleOffsetSeconds(0);
    setShowAudioSubModal(false);

    if (isCasting) {
      if (!castMediaRef.current) return;
      const mediaApi = (window as any).chrome?.cast?.media;
      const selectedTrack =
        index >= 0 ? episode.subtitleTracks[index] : undefined;
      const trackId = selectedTrack
        ? (selectedTrack.index ?? index) + 1
        : undefined;
      if (selectedTrack) {
        const castStartSeconds =
          Number((castMediaRef.current as any)?.customData?.castStartSeconds) ||
          0;
        const offsetSeconds = subtitleOffsetSeconds - castStartSeconds;
        void fetch(
          `/api/media/${media.id}/episode/${episode.id}/subtitles/${selectedTrack.index}?offset=${encodeURIComponent(offsetSeconds)}`,
        ).catch(() => {});
      }
      const castTextTrackStyle = createCastTextTrackStyle(mediaApi);
      const request = mediaApi?.EditTracksInfoRequest
        ? new mediaApi.EditTracksInfoRequest(
            trackId ? [trackId] : [],
            castTextTrackStyle,
          )
        : undefined;
      sendCastMediaCommand('editTracksInfo', request);
      saveProgress(
        castCurrentTimeRef.current,
        duration,
        false,
        true,
        selectedAudioIndex,
        index,
      );
      return;
    }

    saveProgress(
      getLocalPlaybackTime(),
      duration,
      false,
      true,
      selectedAudioIndex,
      index,
    );
  };

  // Handle seeking
  const handleSeek = (targetSec: number) => {
    const video = videoRef.current;

    if (countdownInterval.current) {
      clearInterval(countdownInterval.current);
      countdownInterval.current = null;
    }
    setShowNextCountdown(false);

    isSeekingRef.current = true;
    const clampedSec = Math.max(
      0,
      Math.min(targetSec, duration > 0 ? duration : targetSec),
    );

    if (isCasting) {
      if (!castMediaRef.current) {
        isSeekingRef.current = false;
        return;
      }

      const castUsesOffsetStream =
        !isDirectMP4 || isForceTranscode || selectedAudioIndex > 0;
      if (castUsesOffsetStream && clampedSec < castStreamOffsetRef.current) {
        // The current Chromecast HLS session starts at castStreamOffsetRef.
        // Seeking before that point requires a new HLS session with an earlier
        // input seek; a normal remote seek cannot reach it.
        castCurrentTimeRef.current = clampedSec;
        setCurrentTime(clampedSec);
        void handleCast(
          media,
          episode,
          selectedAudioIndex,
          clampedSec,
          isPlaying,
          false,
        );
        setTimeout(() => {
          isSeekingRef.current = false;
        }, 600);
        return;
      }

      const mediaApi = (window as any).chrome?.cast?.media;
      const request = mediaApi?.SeekRequest
        ? new mediaApi.SeekRequest()
        : undefined;
      if (request) {
        request.currentTime = castUsesOffsetStream
          ? Math.max(0, clampedSec - castStreamOffsetRef.current)
          : clampedSec;
      }
      sendCastMediaCommand('seek', request);
      castCurrentTimeRef.current = clampedSec;
      setCurrentTime(clampedSec);
      saveProgress(clampedSec, duration, false, false);
      setTimeout(() => {
        isSeekingRef.current = false;
      }, 600);
      return;
    }

    if (!video) return;

    const localPosition = getLocalPlaybackTime();
    const shouldUseHls =
      !isDirectMP4 || isForceTranscode || selectedAudioIndex > 0;
    const needsFastHlsRestart =
      shouldUseHls && Math.abs(clampedSec - localPosition) > 20;

    if (needsFastHlsRestart) {
      pendingReloadPositionRef.current = clampedSec;
      resumeAfterReloadRef.current = !video.paused;
      video.pause();
      setCurrentTime(clampedSec);
      setHlsReloadVersion((version) => version + 1);
      saveProgress(clampedSec, duration, false, false);
      setTimeout(() => {
        isSeekingRef.current = false;
      }, 600);
      return;
    }

    try {
      video.currentTime = Math.max(0, clampedSec - hlsStreamOffsetRef.current);
    } catch (err) {
      console.warn('Seek error on video:', err);
    }
    setCurrentTime(clampedSec);
    saveProgress(clampedSec, duration, false, false);

    setTimeout(() => {
      isSeekingRef.current = false;
    }, 600);
  };

  // Sync isFullscreen with native browser events
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () =>
      document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleClosePlayer = useCallback(() => {
    persistPlaybackState(
      isCasting ? castCurrentTimeRef.current : getLocalPlaybackTime(),
    );
    onClose();
  }, [getLocalPlaybackTime, isCasting, onClose, persistPlaybackState]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if inside input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const video = videoRef.current;
      if (!video) return;

      handleUserActivity();

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlayback();
          break;
        case 'arrowleft':
          e.preventDefault();
          handleSeek(currentTime - 10);
          break;
        case 'arrowright':
          e.preventDefault();
          handleSeek(currentTime + 10);
          break;
        case 'arrowup':
          e.preventDefault();
          setVolume((v) => {
            const nv = Math.min(1, Math.round((v + 0.1) * 10) / 10);
            if (isCasting) {
              setCastVolume(nv, false);
            } else {
              video.volume = nv;
            }
            setIsMuted(nv === 0);
            return nv;
          });
          break;
        case 'arrowdown':
          e.preventDefault();
          setVolume((v) => {
            const nv = Math.max(0, Math.round((v - 0.1) * 10) / 10);
            if (isCasting) {
              setCastVolume(nv, nv === 0);
            } else {
              video.volume = nv;
            }
            setIsMuted(nv === 0);
            return nv;
          });
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'p':
          if (e.shiftKey && prevEpisode && onPlayPrevEpisode) {
            e.preventDefault();
            onPlayPrevEpisode();
          }
          break;
        case 'n':
          if (e.shiftKey && nextEpisode && onPlayNextEpisode) {
            e.preventDefault();
            onPlayNextEpisode();
          }
          break;
        case 'escape':
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
            setIsFullscreen(false);
          } else {
            handleClosePlayer();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentTime,
    duration,
    isFullscreen,
    isCasting,
    isPlaying,
    volume,
    handleClosePlayer,
    handleUserActivity,
  ]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Mute toggle
  const toggleMute = () => {
    const nextMuted = !isMuted;

    if (isCasting && castMediaRef.current) {
      setCastVolume(volume, nextMuted);
      setIsMuted(nextMuted);
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (!nextMuted) {
      video.muted = false;
      setIsMuted(false);
    } else {
      video.muted = true;
      setIsMuted(true);
    }
  };

  // Video timeupdate listener
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const exact = Math.max(0, hlsStreamOffsetRef.current + video.currentTime);
    setCurrentTime(exact);

    if (
      video.duration &&
      !isNaN(video.duration) &&
      isFinite(video.duration) &&
      video.duration > 0
    ) {
      if (!episode.durationSeconds || episode.durationSeconds <= 0) {
        setDuration((prev) => Math.max(prev, video.duration));
      }
    }

    const totalDur =
      episode.durationSeconds && episode.durationSeconds > 0
        ? episode.durationSeconds
        : duration;

    // Reset countdown if user moved back before the final 15 seconds
    if (showNextCountdown && totalDur > 30 && exact < totalDur - 15) {
      setShowNextCountdown(false);
      if (countdownInterval.current) {
        clearInterval(countdownInterval.current);
        countdownInterval.current = null;
      }
    }

    // Auto next episode countdown if within 15 seconds of completion
    if (
      nextEpisode &&
      totalDur > 30 &&
      exact >= totalDur - 15 &&
      !showNextCountdown
    ) {
      setShowNextCountdown(true);
      setCountdownSeconds(10);
      if (countdownInterval.current) clearInterval(countdownInterval.current);
      countdownInterval.current = setInterval(() => {
        setCountdownSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval.current);
            if (onPlayNextEpisode) onPlayNextEpisode();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  };

  // Automatic Stream Recovery
  const handleStreamRecovery = useCallback(
    (enableTranscode = true) => {
      if (isRecovering) return;
      setIsRecovering(true);

      if (enableTranscode) {
        setIsForceTranscode(true);
      }

      setTimeout(() => {
        setIsRecovering(false);
      }, 800);
    },
    [isRecovering],
  );

  const handleEnded = () => {
    if (isSeekingRef.current) return;
    const video = videoRef.current;
    const exact = video
      ? Math.max(0, hlsStreamOffsetRef.current + video.currentTime)
      : currentTime;
    const totalExpectedDuration =
      episode.durationSeconds && episode.durationSeconds > 0
        ? episode.durationSeconds
        : duration;

    const isActuallyFinished =
      totalExpectedDuration > 30 && isFinite(totalExpectedDuration)
        ? exact >=
          Math.max(totalExpectedDuration - 20, totalExpectedDuration * 0.9)
        : false;

    if (isActuallyFinished) {
      setIsPlaying(false);
      saveProgress(totalExpectedDuration, totalExpectedDuration, true, true);
      if (nextEpisode && onPlayNextEpisode) {
        onPlayNextEpisode();
      }
    } else {
      console.warn(
        '[VideoPlayer] Playback ended prematurely at',
        exact,
        'of',
        totalExpectedDuration,
      );
      handleStreamRecovery(true);
    }
  };

  const handleVideoError = () => {
    if (isSeekingRef.current || isRecovering) return;
    const err = videoRef.current?.error;
    console.warn('[VideoPlayer] Video element error encountered:', err);
    if (!isForceTranscode) {
      handleStreamRecovery(true);
    } else {
      setPlaybackError(
        'Não foi possível continuar a reprodução deste formato diretamente.',
      );
    }
  };

  // Progress scrubbing calculation
  const handleProgressBarMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos * 100);
    setHoverTime(pos * (duration || 100));
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = pos * (duration || 100);
    handleSeek(target);
  };

  const progressPercent =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      id="video-player-container"
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center select-none overflow-hidden"
      onMouseMove={handleUserActivity}
      onTouchStart={handleUserActivity}
      onClick={handleUserActivity}
    >
      {/* HTML5 Video Element with HLS / Native streaming */}
      <video
        ref={videoRef}
        id="html5-video-player"
        className={`w-full h-full object-contain cursor-pointer transition-opacity duration-200 ${
          isCasting ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => {
          if (castActiveRef.current) {
            videoRef.current?.pause();
            return;
          }
          setIsPlaying(true);
          isSeekingRef.current = false;
        }}
        onPlaying={() => {
          if (castActiveRef.current) {
            videoRef.current?.pause();
            return;
          }
          setIsPlaying(true);
        }}
        onSeeking={() => {
          isSeekingRef.current = true;
        }}
        onSeeked={() => {
          setTimeout(() => {
            isSeekingRef.current = false;
          }, 400);
        }}
        onPause={() => {
          if (castActiveRef.current) return;
          setIsPlaying(false);
          saveProgress(getLocalPlaybackTime(), duration, false, true);
        }}
        onEnded={handleEnded}
        onError={handleVideoError}
        onClick={(e) => {
          e.stopPropagation();
          handleUserActivity();
          if (castActiveRef.current || isCasting) return;
          if (videoRef.current?.paused) {
            videoRef.current.play().catch(() => {});
          } else {
            videoRef.current?.pause();
          }
        }}
        playsInline
      />

      <SubtitleOverlay
        text={activeSubtitleText}
        isCasting={isCasting}
        controlsVisible={controlsVisible}
      />

      {isCasting && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center pointer-events-none">
          <CastIcon className="w-12 h-12 text-red-500 mb-4" />
          <p className="text-white font-semibold">
            Transmitindo{castDeviceName ? ` para ${castDeviceName}` : ''}
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            Use os controles abaixo para pausar, avançar ou trocar o volume.
          </p>
        </div>
      )}

      {/* Stream Recovery Indicator */}
      {isRecovering && (
        <div
          id="player-recovering-indicator"
          className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center z-30 pointer-events-none"
        >
          <Loader2 className="w-12 h-12 text-red-500 animate-spin mb-3" />
          <p className="text-white text-sm font-medium tracking-wide">
            Sincronizando reprodução...
          </p>
        </div>
      )}

      {castError && (
        <button
          type="button"
          onClick={() => setCastError(null)}
          className="absolute top-20 left-1/2 -translate-x-1/2 z-50 max-w-[min(90vw,32rem)] rounded-lg border border-amber-500/40 bg-neutral-950/95 px-4 py-3 text-left text-xs text-amber-200 shadow-xl"
          title="Fechar aviso"
        >
          <span className="font-semibold text-amber-300">Chromecast:</span>{' '}
          {castError}
        </button>
      )}

      {/* Playback Error Overlay */}
      {playbackError && (
        <div
          id="player-error-overlay"
          className="absolute inset-0 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center z-50 p-6 text-center"
        >
          <div className="w-14 h-14 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-4 text-red-400">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">
            Falha na Reprodução
          </h3>
          <p className="text-neutral-300 text-sm max-w-lg mb-6 leading-relaxed">
            {playbackError}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md mb-4">
            {playbackError.toLowerCase().includes('ffmpeg') && (
              <button
                id="player-install-ffmpeg-btn"
                type="button"
                disabled={isInstallingFfmpeg}
                onClick={async () => {
                  setIsInstallingFfmpeg(true);
                  setInstallFfmpegMsg(null);
                  try {
                    const res = await fetch('/api/system/install-ffmpeg', {
                      method: 'POST',
                    });
                    const data = await res.json();
                    if (data.success) {
                      setInstallFfmpegMsg(
                        'FFmpeg instalado! Reiniciando reprodução...',
                      );
                      setTimeout(() => {
                        setPlaybackError(null);
                        setInstallFfmpegMsg(null);
                        handleStreamRecovery(true);
                      }, 1500);
                    } else {
                      setInstallFfmpegMsg(
                        data.message ||
                          'Não foi possível baixar automaticamente. Baixe o ffmpeg.exe e coloque na pasta bin.',
                      );
                    }
                  } catch {
                    setInstallFfmpegMsg('Erro ao contatar o servidor.');
                  } finally {
                    setIsInstallingFfmpeg(false);
                  }
                }}
                className="w-full sm:w-auto px-5 py-2.5 rounded bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-700 text-white font-medium text-sm transition-colors shadow-lg flex items-center justify-center space-x-2"
              >
                {isInstallingFfmpeg ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Instalando FFmpeg na pasta bin...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Instalar FFmpeg (1 Clique)</span>
                  </>
                )}
              </button>
            )}

            <button
              id="player-retry-transcode-btn"
              onClick={() => {
                setPlaybackError(null);
                setInstallFfmpegMsg(null);
                handleStreamRecovery(true);
              }}
              className="w-full sm:w-auto px-5 py-2.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium text-sm transition-colors shadow-lg"
            >
              Tentar Novamente
            </button>
            <button
              id="player-close-error-btn"
              onClick={handleClosePlayer}
              className="w-full sm:w-auto px-5 py-2.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium text-sm transition-colors"
            >
              Voltar
            </button>
          </div>

          {installFfmpegMsg && (
            <p
              className={`text-xs mt-2 font-medium ${installFfmpegMsg.includes('sucesso') || installFfmpegMsg.includes('instalado') ? 'text-emerald-400' : 'text-amber-400'}`}
            >
              {installFfmpegMsg}
            </p>
          )}
        </div>
      )}

      {/* Top Header Bar */}
      <div
        id="player-top-bar"
        onClick={(e) => e.stopPropagation()}
        className={`absolute top-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between z-40 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center space-x-4">
          <button
            id="player-back-btn"
            onClick={onClose}
            className="p-2 rounded-full bg-black/50 hover:bg-neutral-800 text-white transition-colors"
            title="Voltar"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h2 className="text-white font-bold text-base sm:text-lg drop-shadow">
              {media.title}
            </h2>
            <div className="text-xs sm:text-sm text-neutral-300 drop-shadow">
              {media.kind === 'series'
                ? `Temporada ${episode.seasonNumber} : Episódio ${episode.episodeNumber} - ${episode.title}`
                : episode.title}
            </div>
          </div>
        </div>

        {/* Codec & Mode Badge */}
        <div className="hidden sm:flex items-center space-x-2 text-xs text-neutral-400 font-mono">
          <span className="bg-black/60 px-2 py-0.5 rounded border border-neutral-700">
            {episode.extension.toUpperCase()}
          </span>
          {isDirectMP4 ? (
            <span className="bg-emerald-950/80 text-emerald-400 px-2 py-0.5 rounded border border-emerald-800/40">
              Direto (Range 206)
            </span>
          ) : (
            <span className="bg-blue-950/80 text-blue-400 px-2 py-0.5 rounded border border-blue-800/40">
              FFmpeg Remux
            </span>
          )}
        </div>
      </div>

      {/* Next Episode Countdown Overlay */}
      {showNextCountdown && nextEpisode && (
        <div
          id="player-next-countdown"
          className="absolute bottom-28 right-6 z-40 bg-neutral-900/95 border border-white/20 p-4 rounded-xl shadow-2xl backdrop-blur-md max-w-sm flex items-center space-x-4 animate-in slide-in-from-right duration-300"
        >
          <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
            <svg className="w-12 h-12 -rotate-90">
              <circle
                cx="24"
                cy="24"
                r="20"
                stroke="#333"
                strokeWidth="4"
                fill="transparent"
              />
              <circle
                cx="24"
                cy="24"
                r="20"
                stroke="#E50914"
                strokeWidth="4"
                fill="transparent"
                strokeDasharray="125.6"
                strokeDashoffset={`${125.6 * (1 - countdownSeconds / 10)}`}
                className="transition-all duration-1000"
              />
            </svg>
            <span className="absolute font-black text-white text-sm">
              {countdownSeconds}s
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-xs text-neutral-400 uppercase font-semibold">
              Próximo Episódio
            </div>
            <div className="text-sm font-bold text-white truncate">
              {nextEpisode.title}
            </div>
            <div className="flex items-center space-x-2 mt-2">
              <button
                onClick={() => {
                  if (countdownInterval.current)
                    clearInterval(countdownInterval.current);
                  if (onPlayNextEpisode) onPlayNextEpisode();
                }}
                className="px-3 py-1 bg-[#E50914] hover:bg-red-700 text-white text-xs font-bold rounded"
              >
                Assistir Agora
              </button>
              <button
                onClick={() => {
                  setShowNextCountdown(false);
                  if (countdownInterval.current)
                    clearInterval(countdownInterval.current);
                }}
                className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs rounded"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio & Subtitle Modal Popover */}
      {showAudioSubModal && (
        <div
          id="audio-subtitle-menu"
          className="absolute bottom-24 right-8 z-40 bg-[#181818]/95 border border-neutral-700 rounded-xl p-4 shadow-2xl backdrop-blur-md w-80 text-sm text-neutral-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-4">
            {/* Audio Section */}
            <div>
              <h4 className="font-bold text-white text-xs uppercase tracking-wider mb-2 flex items-center space-x-1">
                <span>Áudio</span>
              </h4>
              <div className="space-y-1 max-h-48 overflow-y-auto no-scrollbar">
                {episode.audioTracks.length === 0 ? (
                  <div className="text-xs text-neutral-400">Áudio padrão</div>
                ) : (
                  episode.audioTracks.map((track) => (
                    <button
                      key={`aud-${track.index}`}
                      onClick={() => handleSelectAudio(track.index)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                        selectedAudioIndex === track.index
                          ? 'bg-[#E50914] text-white font-semibold'
                          : 'hover:bg-neutral-700 text-neutral-300'
                      }`}
                    >
                      {track.title || `Faixa ${track.index + 1}`}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Subtitle Section */}
            <div>
              <h4 className="font-bold text-white text-xs uppercase tracking-wider mb-2 flex items-center space-x-1">
                <span>Legendas</span>
              </h4>
              <div className="space-y-1 max-h-48 overflow-y-auto no-scrollbar">
                <button
                  onClick={() => handleSelectSubtitle(-1)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                    selectedSubtitleIndex === -1
                      ? 'bg-[#E50914] text-white font-semibold'
                      : 'hover:bg-neutral-700 text-neutral-300'
                  }`}
                >
                  Desativadas
                </button>
                {episode.subtitleTracks.map((track, idx) => (
                  <button
                    key={`sub-${track.index}`}
                    onClick={() => handleSelectSubtitle(idx)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                      selectedSubtitleIndex === idx
                        ? 'bg-[#E50914] text-white font-semibold'
                        : 'hover:bg-neutral-700 text-neutral-300'
                    }`}
                  >
                    {track.title || `Legenda ${idx + 1}`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <SubtitleSizeSettings
            subtitleOffsetSeconds={subtitleOffsetSeconds}
            onSubtitleOffsetChange={setSubtitleOffsetSeconds}
          />
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div
        id="player-bottom-bar"
        className={`absolute bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex flex-col space-y-3 z-40 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrub Bar */}
        <div
          ref={progressBarRef}
          id="player-scrub-bar"
          className="relative h-2 bg-neutral-700/80 hover:h-3 rounded-full cursor-pointer transition-all flex items-center"
          onMouseMove={handleProgressBarMouseMove}
          onMouseLeave={() => setHoverTime(null)}
          onClick={handleProgressBarClick}
        >
          {/* Filled Progress */}
          <div
            className="h-full bg-[#E50914] rounded-full relative flex items-center justify-end"
            style={{ width: `${progressPercent}%` }}
          >
            {/* Scrubber handle */}
            <div className="w-3.5 h-3.5 rounded-full bg-white shadow-md scale-0 hover:scale-100 group-hover:scale-100 transition-transform" />
          </div>

          {/* Hover Tooltip Time */}
          {hoverTime !== null && (
            <div
              className="absolute -top-8 px-2 py-1 bg-black/90 text-white text-xs font-mono rounded pointer-events-none transform -translate-x-1/2 shadow"
              style={{ left: `${hoverPosition}%` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Buttons Row */}
        <div className="flex items-center justify-between text-white min-w-0">
          {/* Left Controls */}
          <div className="flex min-w-0 flex-1 items-center space-x-2 sm:space-x-4 overflow-x-auto no-scrollbar pr-2">
            {/* Previous Episode Button (shown when not the first episode) */}
            {prevEpisode && onPlayPrevEpisode && (
              <button
                id="player-prev-ep-btn"
                onClick={onPlayPrevEpisode}
                className="p-1 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                title={`Episódio Anterior: ${prevEpisode.title} (Shift + P)`}
              >
                <SkipBack className="w-5 h-5" />
              </button>
            )}

            {/* Play / Pause */}
            <button
              id="player-play-pause-btn"
              onClick={() => {
                togglePlayback();
              }}
              className="p-1 text-white hover:text-red-500 transition-colors"
              title={isPlaying ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 fill-current" />
              ) : (
                <Play className="w-6 h-6 fill-current" />
              )}
            </button>

            {/* Rewind 10s */}
            <button
              id="player-rewind-10-btn"
              onClick={() => handleSeek(currentTime - 10)}
              className="p-1 text-neutral-300 hover:text-white transition-colors"
              title="Voltar 10s (Seta Esquerda)"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            {/* Forward 10s */}
            <button
              id="player-forward-10-btn"
              onClick={() => handleSeek(currentTime + 10)}
              className="p-1 text-neutral-300 hover:text-white transition-colors"
              title="Avançar 10s (Seta Direita)"
            >
              <RotateCw className="w-5 h-5" />
            </button>

            {/* Next Episode Button */}
            {nextEpisode && onPlayNextEpisode && (
              <button
                id="player-next-ep-btn"
                onClick={onPlayNextEpisode}
                className="p-1 text-neutral-300 hover:text-white transition-colors"
                title={`Próximo Episódio: ${nextEpisode.title}`}
              >
                <SkipForward className="w-5 h-5" />
              </button>
            )}

            {/* Volume & Mute Slider */}
            <div className="flex items-center space-x-2 group/volume">
              <button
                onClick={toggleMute}
                className="p-1 text-neutral-300 hover:text-white transition-colors"
                title={isMuted ? 'Ativar Som (M)' : 'Silenciar (M)'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5 text-red-500" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  if (isCasting) {
                    setCastVolume(val, val === 0);
                  } else if (videoRef.current) {
                    videoRef.current.volume = val;
                    videoRef.current.muted = val === 0;
                  }
                  setIsMuted(val === 0);
                }}
                className="w-16 sm:w-24 h-1 bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-[#E50914]"
              />
            </div>

            {/* Time Indicator */}
            <div className="text-xs sm:text-sm font-mono text-neutral-300">
              <span>{formatTime(currentTime)}</span>
              <span className="mx-1 text-neutral-500">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="ml-2 flex shrink-0 items-center space-x-2 sm:space-x-4">
            {showCastButton && (
              <button
                id="player-cast-btn"
                type="button"
                onClick={() => void handleCast()}
                disabled={isCastLoading}
                className={`p-1 transition-colors ${
                  isCasting
                    ? 'text-red-500'
                    : 'text-neutral-300 hover:text-white'
                } disabled:cursor-wait disabled:opacity-60`}
                title={
                  isCasting
                    ? `Transmitindo${castDeviceName ? ` para ${castDeviceName}` : ''}`
                    : 'Transmitir para Chromecast'
                }
                aria-label="Transmitir para Chromecast"
              >
                <CastIcon className="w-5 h-5" />
              </button>
            )}

            {/* Audio & Subtitles Selector */}
            <button
              id="player-audio-sub-btn"
              onClick={() => setShowAudioSubModal(!showAudioSubModal)}
              className={`p-1 transition-colors ${
                showAudioSubModal
                  ? 'text-red-500'
                  : 'text-neutral-300 hover:text-white'
              }`}
              title="Áudio e Legendas"
            >
              <Subtitles className="w-5 h-5" />
            </button>

            {/* Fullscreen */}
            <button
              id="player-fullscreen-btn"
              onClick={toggleFullscreen}
              className="shrink-0 p-1 text-neutral-300 hover:text-white transition-colors touch-manipulation"
              title="Tela Cheia (F)"
              aria-label="Tela cheia"
            >
              {isFullscreen ? (
                <Minimize className="w-5 h-5" />
              ) : (
                <Maximize className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
