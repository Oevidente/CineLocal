import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Key,
  Globe,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Film,
  Tv,
  Check,
} from 'lucide-react';
import { SystemStatus } from '../types';

interface TmdbConfigModalProps {
  onClose: () => void;
  onRefreshLibrary?: () => Promise<void>;
}

export const TmdbConfigModal: React.FC<TmdbConfigModalProps> = ({
  onClose,
  onRefreshLibrary,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [language, setLanguage] = useState('pt-BR');
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<SystemStatus | null>(null);

  const fetchStatus = async () => {
    try {
      setIsLoadingStatus(true);
      const res = await fetch('/api/system/status');
      if (res.ok) {
        const data: SystemStatus = await res.json();
        setCurrentStatus(data);
        if (data.tmdbLanguage) {
          setLanguage(data.tmdbLanguage);
        }
      }
    } catch (err) {
      console.error('Erro ao consultar status:', err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setStatusMessage(null);
    try {
      const queryKey = apiKey.trim();
      const queryToken = accessToken.trim();

      // If key is typed in input, test with it; otherwise test server's active configuration
      let testEndpoint = '/api/system/tmdb/search?query=Avatar&kind=movie';
      if (queryKey || queryToken) {
        // First temporarily test via saving or verifying
        const saveRes = await fetch('/api/system/tmdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: queryKey || undefined,
            accessToken: queryToken || undefined,
            language,
          }),
        });
        if (!saveRes.ok) {
          throw new Error('Falha ao comunicar com o servidor');
        }
      }

      const res = await fetch(testEndpoint);
      const data = await res.json();
      if (res.ok && data.results && data.results.length > 0) {
        setTestResult({
          success: true,
          message: `Conexão bem sucedida! A API retornou ${data.results.length} resultados em português.`,
        });
        await fetchStatus();
      } else if (res.status === 503) {
        setTestResult({
          success: false,
          message: 'TMDb não configurado. Por favor, insira uma chave de API válida.',
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'A chave informada não foi aceita pela API do TMDb.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Erro ao testar comunicação com o TMDb.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setStatusMessage(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/system/tmdb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          accessToken: accessToken.trim() || undefined,
          language,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ text: 'Configurações do TMDb salvas e ativadas com sucesso!' });
        setApiKey('');
        setAccessToken('');
        await fetchStatus();
      } else {
        setStatusMessage({ text: data.error || 'Erro ao salvar configurações.', error: true });
      }
    } catch (err: any) {
      setStatusMessage({ text: err?.message || 'Erro ao comunicar com o servidor.', error: true });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefreshAllMetadata = async () => {
    setIsRefreshingAll(true);
    setRefreshMessage(null);
    try {
      const res = await fetch('/api/library/refresh-all-metadata', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setRefreshMessage(`${data.updatedCount} título(s) atualizados com novas capas e sinopses!`);
        if (onRefreshLibrary) {
          await onRefreshLibrary();
        }
      } else {
        setRefreshMessage(data.error || 'Falha ao buscar capas para a biblioteca.');
      }
    } catch {
      setRefreshMessage('Erro de conexão ao buscar capas.');
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const isConfigured = Boolean(currentStatus?.tmdbConfigured);

  return (
    <div
      id="tmdb-config-modal-backdrop"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="tmdb-config-modal"
        className="relative w-full max-w-xl bg-[#181818] rounded-xl overflow-hidden shadow-2xl border border-pink-500/20 text-neutral-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-neutral-800 flex items-center justify-between bg-gradient-to-r from-neutral-900 via-neutral-900 to-pink-950/30">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <span>Configuração do TMDb</span>
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                  isConfigured
                    ? 'bg-emerald-950/80 border border-emerald-700/80 text-emerald-400 font-bold'
                    : 'bg-amber-950/80 border border-amber-700/80 text-amber-300 font-bold'
                }`}>
                  {isConfigured ? 'Conectado' : 'Não Configurado'}
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                The Movie Database — Capas oficiais, banners, sinopses e elenco
              </p>
            </div>
          </div>
          <button
            id="close-tmdb-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-5 max-h-[calc(100vh-140px)] overflow-y-auto">
          {/* Status Box */}
          <div className={`p-4 rounded-xl border flex items-start gap-3 ${
            isConfigured
              ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
              : 'bg-amber-950/20 border-amber-800/40 text-amber-300'
          }`}>
            {isConfigured ? (
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            )}
            <div className="text-xs space-y-1">
              <div className="font-semibold text-white">
                {isConfigured
                  ? 'A API do TMDb está ativa e pronta para uso!'
                  : 'A chave do TMDb ainda não está configurada'}
              </div>
              <p className="text-neutral-300 leading-relaxed">
                {isConfigured
                  ? 'Ao adicionar pastas de filmes ou séries, o CineLocal baixa automaticamente posters verticais em HD, banners de fundo e sinopses completas em português.'
                  : 'Para que o CineLocal baixe capas automáticas e sinopses em alta definição dos seus filmes e séries, insira sua chave gratuita de desenvolvedor do TMDb abaixo.'}
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSave} className="space-y-4">
            {/* API Key v3 */}
            <div>
              <label className="block text-xs font-semibold text-neutral-200 mb-1.5">
                Chave da API do TMDb (API Key v3):
              </label>
              <div className="relative">
                <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  id="tmdb-api-key-input"
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    isConfigured
                      ? '•••••••••••••••••••••••••••••••• (Chave ativa salva no sistema)'
                      : 'Ex: bf478b3fda0d0a81bbe94ca9cb292b33'
                  }
                  className="w-full bg-black/60 border border-neutral-700 focus:border-pink-500 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-neutral-500 font-mono outline-none transition-colors"
                />
              </div>
              <p className="text-[11px] text-neutral-500 mt-1">
                {isConfigured
                  ? 'Deixe em branco para manter a chave atual ou digite uma nova para substituir.'
                  : 'Chave de 32 caracteres gerada gratuitamente na sua conta do themoviedb.org.'}
              </p>
            </div>

            {/* Language Selection */}
            <div>
              <label className="block text-xs font-semibold text-neutral-200 mb-1.5">
                Idioma dos metadados e sinopses:
              </label>
              <div className="relative">
                <Globe className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <select
                  id="tmdb-language-select"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full bg-black/60 border border-neutral-700 focus:border-pink-500 rounded-lg pl-9 pr-4 py-2 text-xs text-white outline-none cursor-pointer"
                >
                  <option value="pt-BR">Português (Brasil) — pt-BR</option>
                  <option value="pt-PT">Português (Portugal) — pt-PT</option>
                  <option value="en-US">English (US) — en-US</option>
                  <option value="es-ES">Español — es-ES</option>
                  <option value="fr-FR">Français — fr-FR</option>
                  <option value="it-IT">Italiano — it-IT</option>
                  <option value="de-DE">Deutsch — de-DE</option>
                  <option value="ja-JP">日本語 (Japanese) — ja-JP</option>
                </select>
              </div>
            </div>

            {/* Status / Error feedback */}
            {statusMessage && (
              <div className={`p-3 rounded-lg text-xs font-semibold flex items-center space-x-2 ${
                statusMessage.error
                  ? 'bg-amber-950/40 border border-amber-800 text-amber-300'
                  : 'bg-emerald-950/40 border border-emerald-800 text-emerald-300'
              }`}>
                {!statusMessage.error ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{statusMessage.text}</span>
              </div>
            )}

            {/* Test Result feedback */}
            {testResult && (
              <div className={`p-3 rounded-lg text-xs font-semibold flex items-center space-x-2 ${
                testResult.success
                  ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-300'
                  : 'bg-amber-950/40 border border-amber-800 text-amber-300'
              }`}>
                {testResult.success ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-pink-600/20 transition-all flex items-center space-x-2"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>{isSaving ? 'Salvando...' : 'Salvar Configuração'}</span>
              </button>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 text-xs font-medium border border-white/5 transition-all flex items-center space-x-2"
              >
                {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4 text-emerald-400" />}
                <span>{isTesting ? 'Testando conexão...' : 'Testar Conexão'}</span>
              </button>

              {isConfigured && (
                <button
                  type="button"
                  onClick={handleRefreshAllMetadata}
                  disabled={isRefreshingAll}
                  className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 text-xs font-medium border border-white/5 transition-all flex items-center space-x-2"
                  title="Baixar capas para todos os filmes e séries já escaneados"
                >
                  <RefreshCw className={`w-4 h-4 text-pink-400 ${isRefreshingAll ? 'animate-spin' : ''}`} />
                  <span>{isRefreshingAll ? 'Baixando capas...' : 'Buscar Capas da Biblioteca'}</span>
                </button>
              )}
            </div>

            {refreshMessage && (
              <p className="text-xs text-emerald-400 font-medium">{refreshMessage}</p>
            )}
          </form>

          {/* Quick Guide */}
          <div className="p-4 rounded-xl bg-neutral-900/90 border border-neutral-800 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-white">
              <span className="flex items-center space-x-1.5">
                <Film className="w-4 h-4 text-pink-400" />
                <span>Como obter sua chave gratuita do TMDb (Passo a Passo)</span>
              </span>
              <a
                href="https://www.themoviedb.org/signup"
                target="_blank"
                rel="noreferrer"
                className="text-pink-400 hover:underline flex items-center gap-1 text-[11px]"
              >
                <span>themoviedb.org</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <ol className="text-xs text-neutral-300 space-y-2 list-decimal list-inside leading-relaxed">
              <li>
                Acesse <strong className="text-white">themoviedb.org</strong> e crie uma conta gratuita (ou faça login).
              </li>
              <li>
                Clique na sua foto de perfil no canto superior direito &gt; <strong className="text-white">Configurações (Settings)</strong>.
              </li>
              <li>
                No menu lateral, clique em <strong className="text-white">API</strong> e selecione <strong className="text-white">Criar / Solicitar Chave de API</strong> (escolha tipo <em>Developer</em>).
              </li>
              <li>
                Aceite os termos e preencha os dados básicos (ex: Nome do App: <em>CineLocal</em>).
              </li>
              <li>
                Copie a <strong className="text-pink-400">Chave da API (v3 auth)</strong> e cole no campo acima!
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
