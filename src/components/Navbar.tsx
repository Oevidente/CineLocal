import React, { useState, useEffect, useRef } from 'react';
import { Film, Plus, HardDrive, Search, Tv, Loader2, Radio, Sparkles, Home, MoreVertical, X, FolderPlus } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface NavbarProps {
  activeTab: 'all' | 'series' | 'movie' | 'channels';
  onTabChange: (tab: 'all' | 'series' | 'movie' | 'channels') => void;
  onOpenAddModal: () => void;
  onOpenSystemModal: () => void;
  onOpenTorrentModal: () => void;
  onOpenTmdbModal?: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isPickingFolder?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  onOpenAddModal,
  onOpenSystemModal,
  onOpenTorrentModal,
  onOpenTmdbModal,
  searchQuery,
  onSearchChange,
  isPickingFolder = false,
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const desktopSearchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const isExpanded = isSearchOpen || Boolean(searchQuery && searchQuery.trim().length > 0);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto focus input whenever search opens
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => {
        desktopSearchInputRef.current?.focus();
      }, 50);
    }
  }, [isSearchOpen]);

  // Handle clicking outside of search bar to close if empty
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node) &&
        !searchQuery
      ) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [searchQuery]);

  return (
    <>
      {/* Top Header Navbar */}
      <header
        id="navbar"
        className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 w-full ${
          isScrolled
            ? 'bg-[#141414]/95 backdrop-blur-md shadow-2xl py-2.5 sm:py-3 border-b border-white/5'
            : 'bg-gradient-to-b from-black/95 via-black/60 to-transparent py-3 sm:py-4'
        }`}
      >
        <div className="px-4 sm:px-6 lg:px-8 flex items-center justify-between w-full min-w-0 gap-2 md:gap-3 lg:gap-4">
          {/* Left: Brand Logo + Desktop Navigation / Expanding Search Bar */}
          <div className="flex items-center flex-1 min-w-0 mr-1 sm:mr-2 lg:mr-4">
            {/* Brand Logo */}
            <div
              id="brand-logo"
              onClick={() => {
                onTabChange('all');
                setShowMobileMenu(false);
              }}
              className="cursor-pointer flex items-center space-x-1.5 sm:space-x-2 shrink-0 group select-none mr-2 sm:mr-4 md:mr-3 lg:mr-6"
            >
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded bg-[#E50914] flex items-center justify-center font-black text-white text-base sm:text-xl tracking-tighter shadow-lg shadow-red-950/40 shrink-0">
                C
              </div>
              <span className="text-base sm:text-xl lg:text-2xl font-black tracking-wider text-[#E50914] uppercase drop-shadow-md">
                Cine<span className="text-white">Local</span>
              </span>
            </div>

            {/* Desktop Navigation Links (Smoothly fades out and collapses when search expands) */}
            <nav
              className={`hidden md:flex items-center space-x-1.5 md:space-x-2 lg:space-x-4 xl:space-x-6 text-xs lg:text-sm font-medium transition-all duration-300 shrink-0 ${
                isExpanded ? 'opacity-0 scale-95 pointer-events-none w-0 overflow-hidden' : 'opacity-100 scale-100'
              }`}
            >
              <button
                id="nav-tab-all"
                onClick={() => onTabChange('all')}
                className={`px-1.5 lg:px-2 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'all' ? 'text-white font-semibold' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Início
              </button>
              <button
                id="nav-tab-series"
                onClick={() => onTabChange('series')}
                className={`px-1.5 lg:px-2 py-1 rounded-md transition-colors flex items-center space-x-1 cursor-pointer whitespace-nowrap ${
                  activeTab === 'series' ? 'text-white font-semibold' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Tv className="w-3.5 h-3.5 mr-1 inline shrink-0" />
                Séries
              </button>
              <button
                id="nav-tab-movie"
                onClick={() => onTabChange('movie')}
                className={`px-1.5 lg:px-2 py-1 rounded-md transition-colors flex items-center space-x-1 cursor-pointer whitespace-nowrap ${
                  activeTab === 'movie' ? 'text-white font-semibold' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Film className="w-3.5 h-3.5 mr-1 inline shrink-0" />
                Filmes
              </button>
              <button
                id="nav-tab-channels"
                onClick={() => onTabChange('channels')}
                className={`transition-all flex items-center space-x-1.5 px-2 lg:px-2.5 py-1 rounded-full cursor-pointer whitespace-nowrap shrink-0 ${
                  activeTab === 'channels'
                    ? 'bg-red-600/30 text-red-400 border border-red-500/50 font-bold shadow-sm shadow-red-950/50'
                    : 'text-neutral-400 hover:text-red-400 hover:bg-red-950/20'
                }`}
              >
                <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse shrink-0" />
                <span className="hidden xl:inline">Canais </span>
                <span>Ao Vivo</span>
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
              </button>
            </nav>

            {/* Expanded Search Bar filling space dynamically right after CineLocal logo */}
            <div
              ref={searchContainerRef}
              className={`hidden md:flex items-center transition-all duration-300 ease-out ${
                isExpanded
                  ? 'flex-1 opacity-100 max-w-full'
                  : 'w-0 opacity-0 pointer-events-none overflow-hidden'
              }`}
            >
              <div className="relative flex items-center w-full bg-[#181818]/95 border border-neutral-700/80 hover:border-neutral-600 focus-within:border-neutral-400 focus-within:ring-1 focus-within:ring-neutral-400/20 rounded-full px-3.5 py-1.5 lg:py-2 text-xs lg:text-sm transition-all shadow-inner">
                <Search className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-neutral-400 mr-2 shrink-0" />
                <input
                  ref={desktopSearchInputRef}
                  id="search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Buscar filmes, séries, atores, diretores..."
                  className="bg-transparent border-none text-white focus:outline-none w-full text-xs lg:text-sm placeholder-neutral-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      onSearchChange('');
                      setIsSearchOpen(false);
                    }
                  }}
                />
                {searchQuery ? (
                  <button
                    onClick={() => {
                      onSearchChange('');
                      setIsSearchOpen(false);
                    }}
                    className="text-neutral-400 hover:text-white p-1 rounded-full hover:bg-neutral-800 transition-colors ml-1 shrink-0 cursor-pointer"
                    title="Limpar e fechar busca"
                  >
                    <X className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => setIsSearchOpen(false)}
                    className="text-neutral-500 hover:text-neutral-300 p-1 rounded-full hover:bg-neutral-800/60 transition-colors ml-1 shrink-0 cursor-pointer"
                    title="Fechar busca"
                  >
                    <X className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right: Actions on Desktop & Tablet */}
          <div className="hidden md:flex items-center gap-1.5 md:gap-2 lg:gap-2.5 xl:gap-3 shrink-0">
            {/* Search Toggle Button (Lupa) - When clicked, hides links and expands search bar */}
            {!isExpanded && (
              <button
                id="search-toggle-btn"
                onClick={() => {
                  setIsSearchOpen(true);
                }}
                className="p-1.5 lg:p-2 text-neutral-300 hover:text-white transition-colors rounded-full hover:bg-white/10 cursor-pointer flex items-center justify-center shrink-0"
                title="Buscar filmes, séries, atores, diretores..."
              >
                <Search className="w-4 h-4 lg:w-5 lg:h-5" />
              </button>
            )}

            {/* Torrent Player Button */}
            <button
              id="torrent-player-btn"
              onClick={onOpenTorrentModal}
              className="h-8 lg:h-9 flex items-center gap-1 md:gap-1.5 px-2 md:px-2.5 lg:px-3 rounded-lg bg-neutral-900/90 hover:bg-neutral-800 text-amber-400 hover:text-amber-300 text-xs lg:text-sm font-medium transition-all border border-neutral-700/80 hover:border-amber-500/50 shadow-sm active:scale-95 cursor-pointer shrink-0"
              title="Abrir Player Torrent / Link Magnet"
            >
              <Radio className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-amber-400 shrink-0" />
              <span className="hidden xl:inline">Player </span>
              <span>Torrent</span>
            </button>

            {/* Add Folder Button */}
            <button
              id="add-folder-btn"
              onClick={onOpenAddModal}
              disabled={isPickingFolder}
              className="h-8 lg:h-9 flex items-center gap-1 md:gap-1.5 px-2 md:px-2.5 lg:px-3.5 rounded-lg bg-[#E50914] hover:bg-[#b80710] text-white text-xs lg:text-sm font-medium transition-all shadow-md hover:shadow-red-600/20 active:scale-95 disabled:opacity-75 cursor-pointer shrink-0"
              title="Adicionar pasta do PC pelo explorador nativo"
            >
              {isPickingFolder ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 lg:w-4 lg:h-4 animate-spin shrink-0" />
                  <span className="text-xs lg:text-sm">Explorador...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5 lg:w-4 lg:h-4 shrink-0" />
                  <span className="hidden xl:inline">Adicionar </span>
                  <span>Pasta</span>
                  <span className="hidden 2xl:inline"> PC</span>
                </>
              )}
            </button>

            {/* Install PWA Button */}
            <PWAInstallButton />

            {/* TMDb Config button */}
            {onOpenTmdbModal && (
              <button
                id="tmdb-config-navbar-btn"
                onClick={onOpenTmdbModal}
                className="p-1.5 lg:p-2 text-pink-400 hover:text-pink-300 rounded-md hover:bg-pink-500/15 transition-colors cursor-pointer shrink-0"
                title="Configurar TMDb (Capas e Sinopses)"
              >
                <Sparkles className="w-4 h-4 lg:w-5 lg:h-5" />
              </button>
            )}

            {/* System Status button */}
            <button
              id="system-status-btn"
              onClick={onOpenSystemModal}
              className="p-1.5 lg:p-2 text-neutral-300 hover:text-white rounded-md hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              title="Status do Sistema e Portabilidade"
            >
              <HardDrive className="w-4 h-4 lg:w-5 lg:h-5" />
            </button>
          </div>

          {/* Right: Actions on Mobile */}
          <div className="flex md:hidden items-center space-x-1 sm:space-x-2 shrink-0">
            {/* Search Toggle Icon */}
            <button
              id="mobile-search-toggle"
              onClick={() => setIsSearchOpen(true)}
              className="p-2 text-neutral-200 hover:text-white active:bg-white/10 rounded-full transition-colors cursor-pointer"
              title="Buscar"
            >
              <Search className="w-5 h-5" />
            </button>

            {/* Add Folder PC Button (Compact) */}
            <button
              id="mobile-add-folder-btn"
              onClick={onOpenAddModal}
              disabled={isPickingFolder}
              className="p-2 bg-[#E50914] text-white rounded-lg active:scale-95 transition-all shadow cursor-pointer disabled:opacity-75 flex items-center justify-center"
              title="Adicionar Pasta do PC"
            >
              {isPickingFolder ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </button>

            {/* Player Torrent Button (Compact) */}
            <button
              id="mobile-torrent-btn"
              onClick={onOpenTorrentModal}
              className="p-2 bg-zinc-800 text-amber-400 border border-zinc-700 rounded-lg active:scale-95 transition-all cursor-pointer flex items-center justify-center"
              title="Player Torrent"
            >
              <Radio className="w-4 h-4" />
            </button>

            {/* Mobile Menu Options (Drawer Sheet) */}
            <button
              id="mobile-menu-toggle"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="p-2 text-neutral-300 hover:text-white active:bg-white/10 rounded-lg transition-colors cursor-pointer flex items-center justify-center"
              title="Menu de Ferramentas"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mobile Fullscreen Header Search Bar Overlay */}
        {isExpanded && (
          <div className="md:hidden absolute inset-0 bg-[#141414] px-3 sm:px-6 flex items-center justify-between z-50 animate-in fade-in duration-150 border-b border-neutral-800">
            <div className="flex items-center flex-1 bg-neutral-900 border border-neutral-700 rounded-full px-3 py-1.5 text-sm mr-2">
              <Search className="w-4 h-4 text-neutral-400 mr-2 shrink-0" />
              <input
                id="mobile-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Buscar filmes, séries, atores, diretores..."
                className="bg-transparent border-none text-white focus:outline-none w-full text-xs sm:text-sm"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => onSearchChange('')}
                  className="p-1 text-neutral-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => {
                setIsSearchOpen(false);
                onSearchChange('');
              }}
              className="text-xs font-semibold text-neutral-300 hover:text-white px-3 py-1.5 rounded-lg bg-neutral-800 shrink-0 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}
      </header>

      {/* Mobile Drawer / Action Sheet Modal */}
      {showMobileMenu && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200 md:hidden"
          onClick={() => setShowMobileMenu(false)}
        >
          <div
            className="w-full max-w-md bg-[#181818] rounded-t-2xl sm:rounded-2xl border-t sm:border border-white/10 p-5 text-neutral-200 space-y-4 shadow-2xl animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Handle */}
            <div className="w-12 h-1 bg-neutral-700 rounded-full mx-auto mb-2 sm:hidden" />

            {/* Title & Close */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded bg-[#E50914] flex items-center justify-center font-black text-white text-base">
                  C
                </div>
                <span className="font-bold text-white text-base">Ferramentas CineLocal</span>
              </div>
              <button
                onClick={() => setShowMobileMenu(false)}
                className="p-1.5 rounded-full bg-neutral-800 text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Menu Action List */}
            <div className="space-y-2 text-sm">
              <button
                onClick={() => {
                  setShowMobileMenu(false);
                  onOpenAddModal();
                }}
                className="w-full flex items-center space-x-3 p-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-left transition cursor-pointer"
              >
                <div className="p-2 rounded-lg bg-red-600/20 text-[#E50914]">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold text-white">Adicionar Pasta do PC</div>
                  <div className="text-xs text-neutral-400">Escaneie vídeos do seu computador ou pendrive</div>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowMobileMenu(false);
                  onOpenTorrentModal();
                }}
                className="w-full flex items-center space-x-3 p-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-left transition cursor-pointer"
              >
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
                  <Radio className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold text-white">Player Torrent & Magnet</div>
                  <div className="text-xs text-neutral-400">Reproduza vídeos diretamente por links P2P</div>
                </div>
              </button>

              {onOpenTmdbModal && (
                <button
                  onClick={() => {
                    setShowMobileMenu(false);
                    onOpenTmdbModal();
                  }}
                  className="w-full flex items-center space-x-3 p-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-left transition cursor-pointer"
                >
                  <div className="p-2 rounded-lg bg-pink-500/20 text-pink-400">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-white">Capas e Sinopses (TMDb)</div>
                    <div className="text-xs text-neutral-400">Configurar metadados automáticos em HD</div>
                  </div>
                </button>
              )}

              <button
                onClick={() => {
                  setShowMobileMenu(false);
                  onOpenSystemModal();
                }}
                className="w-full flex items-center space-x-3 p-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-left transition cursor-pointer"
              >
                <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold text-white">Status do Sistema e Portabilidade</div>
                  <div className="text-xs text-neutral-400">Verifique o FFmpeg, acelerador de vídeo e dados local</div>
                </div>
              </button>

              <div className="pt-2 flex items-center justify-between">
                <div
                  onClick={() => {
                    setShowMobileMenu(false);
                    onOpenSystemModal();
                  }}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 text-xs font-mono cursor-pointer"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>100% Offline (Local)</span>
                </div>

                <PWAInstallButton />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modern Mobile Bottom Navigation Bar (Barra de Navegação Inferior) */}
      <nav
        id="mobile-bottom-nav"
        className="fixed bottom-0 left-0 right-0 z-40 bg-[#141414]/95 backdrop-blur-xl border-t border-white/10 md:hidden px-2 py-1.5 flex items-center justify-around shadow-2xl"
      >
        <button
          onClick={() => onTabChange('all')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors cursor-pointer ${
            activeTab === 'all' ? 'text-[#E50914] font-semibold' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Início</span>
        </button>

        <button
          onClick={() => onTabChange('series')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors cursor-pointer ${
            activeTab === 'series' ? 'text-[#E50914] font-semibold' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Tv className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Séries</span>
        </button>

        <button
          onClick={() => onTabChange('movie')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors cursor-pointer ${
            activeTab === 'movie' ? 'text-[#E50914] font-semibold' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Film className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Filmes</span>
        </button>

        <button
          onClick={() => onTabChange('channels')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors cursor-pointer relative ${
            activeTab === 'channels' ? 'text-red-500 font-bold' : 'text-neutral-400 hover:text-red-400'
          }`}
        >
          <div className="relative">
            <Radio className="w-5 h-5 mb-0.5" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          </div>
          <span className="text-[10px]">Ao Vivo</span>
        </button>
      </nav>
    </>
  );
};
