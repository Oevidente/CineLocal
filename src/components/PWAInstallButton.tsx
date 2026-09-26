import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1 md:gap-1.5 h-8 lg:h-9 px-2 md:px-2.5 lg:px-3 rounded-lg bg-[#E50914] hover:bg-red-700 text-white text-xs lg:text-sm font-semibold shadow-md hover:shadow-red-600/20 transition active:scale-95 cursor-pointer shrink-0"
        title="Instalar CineLocal no dispositivo"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden xl:inline">Instalar App</span>
        <span className="hidden sm:inline xl:hidden">Instalar</span>
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1 md:gap-1.5 h-8 lg:h-9 px-2 md:px-2.5 lg:px-3 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 border border-white/10 text-xs lg:text-sm font-semibold transition active:scale-95 cursor-pointer shrink-0"
          title="Instalar CineLocal no iOS"
        >
          <Smartphone className="w-3.5 h-3.5 text-red-500 shrink-0" />
          <span className="hidden sm:inline">Instalar</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="relative w-full max-w-sm rounded-xl bg-[#181818] p-6 shadow-2xl border border-white/10 text-neutral-200"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowIOSGuide(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-red-950/60 border border-red-800/60 flex items-center justify-center text-red-400">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Instalar no iPhone / iPad</h3>
                  <p className="text-[11px] text-neutral-400">Adicione o CineLocal à sua tela de início</p>
                </div>
              </div>

              <div className="mt-3 space-y-2.5 text-xs text-neutral-300 bg-neutral-900/60 p-3.5 rounded-lg border border-neutral-800">
                <p className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5">1</span>
                  <span>Toque no botão <strong className="text-white">Compartilhar</strong> na barra do Safari.</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5">2</span>
                  <span>Role para baixo e selecione <strong className="text-white">Adicionar à Tela de Início</strong>.</span>
                </p>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-lg bg-[#E50914] py-2 text-xs font-bold text-white hover:bg-red-700 transition"
              >
                Entendi
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
