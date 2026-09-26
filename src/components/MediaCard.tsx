import React from 'react';
import { Play, Info, CheckCircle2, Radio } from 'lucide-react';
import { MediaItem, Episode } from '../types';
import { formatTime } from '../utils';

interface MediaCardProps {
  media: MediaItem;
  continueEpisode?: Episode;
  onPlay: (media: MediaItem, episode?: Episode) => void;
  onOpenDetails: (media: MediaItem) => void;
  variant?: 'poster' | 'backdrop';
}

export const MediaCard: React.FC<MediaCardProps> = ({
  media,
  continueEpisode,
  onPlay,
  onOpenDetails,
  variant = 'poster',
}) => {
  // Check if fully watched
  const isAllWatched = media.seasons.every((s) => s.episodes.every((e) => e.watched));

  // Determine active episode for progress
  const activeEp =
    continueEpisode ||
    (media.lastWatchedEpisodeId
      ? media.seasons.flatMap((s) => s.episodes).find((e) => e.id === media.lastWatchedEpisodeId)
      : media.seasons[0]?.episodes[0]);

  const hasProgress = activeEp && activeEp.durationSeconds > 0 && activeEp.progressSeconds > 0 && !activeEp.watched;
  const progressPercent = hasProgress
    ? Math.min(100, Math.floor((activeEp.progressSeconds / activeEp.durationSeconds) * 100))
    : 0;

  const posterUrl = media.posterPath?.startsWith('http')
    ? media.posterPath
    : `/api/media/${media.id}/poster`;

  const backdropUrl = media.backdropPath
    ? (media.backdropPath.startsWith('http') ? media.backdropPath : `/api/media/${media.id}/backdrop`)
    : (activeEp ? `/api/media/${media.id}/episode/${activeEp.id}/thumb` : posterUrl);

  const displayImage = variant === 'backdrop' ? backdropUrl : posterUrl;

  return (
    <div
      id={`media-card-${media.id}`}
      className="group relative shrink-0 select-none cursor-pointer"
      onClick={() => onOpenDetails(media)}
    >
      <div
        className={`relative rounded-md overflow-hidden bg-neutral-900 border border-white/5 transition-all duration-300 transform group-hover:scale-105 group-hover:z-20 group-hover:shadow-2xl group-hover:shadow-black/80 ${
          variant === 'backdrop' ? 'w-60 sm:w-72 aspect-video' : 'w-36 sm:w-44 aspect-[2/3]'
        }`}
      >
        {/* Poster / Thumbnail Image */}
        <img
          src={displayImage}
          alt={media.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          onError={(e) => {
            // Fallback gradient with clean typography if file poster fails
            const target = e.currentTarget;
            target.style.display = 'none';
            if (target.parentElement) {
              target.parentElement.classList.add('flex', 'items-center', 'justify-center', 'p-3', 'text-center');
            }
          }}
        />

        {/* Top Badges */}
        <div className="absolute top-2 left-2 flex items-center space-x-1 z-10">
          <span className="bg-black/70 backdrop-blur-xs text-[10px] uppercase font-bold text-neutral-200 px-1.5 py-0.5 rounded">
            {media.kind === 'series' ? 'Série' : 'Filme'}
          </span>
          {media.isTorrent && (
            <span className="bg-red-950/90 text-red-300 border border-red-800/60 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shadow-sm">
              <Radio className="w-2.5 h-2.5 text-red-400" />
              Magnet
            </span>
          )}
          {isAllWatched && (
            <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 p-0.5 rounded-full" title="Assistido">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </span>
          )}
        </div>

        {/* Hover overlay with actions */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3 z-10">
          <div className="text-white font-bold text-sm line-clamp-1 mb-1">{media.title}</div>

          {continueEpisode ? (
            <div className="text-[11px] text-red-400 font-medium line-clamp-1 mb-2">
              {media.kind === 'series'
                ? `T${continueEpisode.seasonNumber}:E${continueEpisode.episodeNumber} - ${continueEpisode.title}`
                : `Parou em ${formatTime(continueEpisode.progressSeconds)}`}
            </div>
          ) : (
            <div className="text-[11px] text-neutral-400 line-clamp-1 mb-2">
              {media.kind === 'series'
                ? `${media.totalSeasons} Temp · ${media.totalEpisodes} eps`
                : (activeEp?.durationSeconds ? formatTime(activeEp.durationSeconds) : (activeEp?.resolution || 'Filme'))}
            </div>
          )}

          {/* Quick Buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(media, activeEp);
              }}
              className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:bg-neutral-200 transition-all shadow-md active:scale-95"
              title="Assistir agora"
            >
              <Play className="w-4 h-4 fill-black ml-0.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetails(media);
              }}
              className="w-8 h-8 rounded-full bg-neutral-800/90 text-white border border-neutral-600 flex items-center justify-center hover:bg-neutral-700 transition-all shadow-md active:scale-95"
              title="Detalhes"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Bottom Red Progress Bar */}
        {hasProgress && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-800 z-10">
            <div className="h-full bg-[#E50914]" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
      </div>

      {/* Subtitle text below card for backdrop variant */}
      {variant === 'backdrop' && continueEpisode && (
        <div className="mt-1.5 px-0.5">
          <div className="text-xs font-semibold text-neutral-200 line-clamp-1">{media.title}</div>
          <div className="text-[11px] text-neutral-400 flex items-center justify-between">
            <span>
              T{continueEpisode.seasonNumber}:E{continueEpisode.episodeNumber}
            </span>
            {continueEpisode.durationSeconds > 0 && (
              <span>
                {formatTime(continueEpisode.progressSeconds)} / {formatTime(continueEpisode.durationSeconds)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
