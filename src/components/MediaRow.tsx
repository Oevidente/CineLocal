import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaCard } from './MediaCard';
import { MediaItem, Episode } from '../types';

interface MediaRowProps {
  id: string;
  title: string;
  items: { media: MediaItem; continueEpisode?: Episode }[];
  onPlay: (media: MediaItem, episode?: Episode) => void;
  onOpenDetails: (media: MediaItem) => void;
  variant?: 'poster' | 'backdrop';
}

export const MediaRow: React.FC<MediaRowProps> = ({
  id,
  title,
  items,
  onPlay,
  onOpenDetails,
  variant = 'poster',
}) => {
  const rowRef = useRef<HTMLDivElement>(null);

  const handleScroll = (direction: 'left' | 'right') => {
    if (!rowRef.current) return;
    const scrollAmount = rowRef.current.clientWidth * 0.75;
    rowRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  if (items.length === 0) return null;

  return (
    <section id={id} className="relative mb-8 sm:mb-12 group/row">
      <div className="px-4 sm:px-6 lg:px-8 mb-3 flex items-center justify-between">
        <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide flex items-center space-x-2">
          <span>{title}</span>
          <span className="text-xs text-neutral-500 font-normal">({items.length})</span>
        </h2>
      </div>

      <div className="relative">
        {/* Left scroll chevron */}
        <button
          onClick={() => handleScroll('left')}
          className="absolute left-0 top-0 bottom-0 z-30 w-10 sm:w-12 bg-black/60 hover:bg-black/85 text-white flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 cursor-pointer disabled:hidden"
          aria-label="Rolar para esquerda"
        >
          <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8 text-white drop-shadow" />
        </button>

        {/* Horizontal Card Container */}
        <div
          ref={rowRef}
          className="flex space-x-3 sm:space-x-4 overflow-x-auto no-scrollbar scroll-smooth px-4 sm:px-6 lg:px-8 py-2"
        >
          {items.map(({ media, continueEpisode }) => (
            <MediaCard
              key={`${media.id}-${continueEpisode?.id || 'main'}`}
              media={media}
              continueEpisode={continueEpisode}
              onPlay={onPlay}
              onOpenDetails={onOpenDetails}
              variant={variant}
            />
          ))}
        </div>

        {/* Right scroll chevron */}
        <button
          onClick={() => handleScroll('right')}
          className="absolute right-0 top-0 bottom-0 z-30 w-10 sm:w-12 bg-black/60 hover:bg-black/85 text-white flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 cursor-pointer"
          aria-label="Rolar para direita"
        >
          <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8 text-white drop-shadow" />
        </button>
      </div>
    </section>
  );
};
