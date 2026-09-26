import React, { useState, useEffect } from 'react';
import { Smartphone, Wifi, Copy, Check, ChevronDown, ChevronUp, AlertCircle, Info, Globe, Shield, ExternalLink, Cloud, Server } from 'lucide-react';

interface NetworkInfo {
  protocol: string;
  port: number;
  addresses: string[];
  mobileUrls: string[];
  certPath?: string;
}

interface MobileAccessBannerProps {
  onCloseBanner?: () => void;
  className?: string;
}

export const MobileAccessBanner: React.FC<MobileAccessBannerProps> = ({ onCloseBanner, className = '' }) => {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedIpIndex, setSelectedIpIndex] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showHelpDetails, setShowHelpDetails] = useState<boolean>(false);
  const [accessMode, setAccessMode] = useState<'local' | 'remote'>('local');

  useEffect(() => {
    fetch('/api/system/network-info')
      .then((res) => res.json())
      .then((data: NetworkInfo) => {
        setNetworkInfo(data);
      })
      .catch((err) => console.error('Erro ao buscar dados de rede:', err))
      .finally(() => setLoading(false));
  }, []);

  // Compute active mobile URL
  const activeUrl = React.useMemo(() => {
    if (networkInfo && networkInfo.addresses.length > 0) {
      const ip = networkInfo.addresses[selectedIpIndex] || networkInfo.addresses[0];
      return `${networkInfo.protocol || 'https'}://${ip}:${networkInfo.port || 3050}`;
    }
    const host = window.location.hostname || '192.168.1.15';
    const port = networkInfo?.port || 3050;
    const protocol = networkInfo?.protocol || 'https';
    return `${protocol}://${host}:${port}`;
  }, [networkInfo, selectedIpIndex]);

  const handleCopy = () => {
    navigator.clipboard.writeText(activeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (loading) {
    return (
      <div className={`p-2.5 rounded-xl bg-[#181818] border border-neutral-800 text-neutral-400 text-xs animate-pulse ${className}`}>
        Carregando endereço de rede local...
      </div>
    );
  }

  return (
    <div
      id="mobile-access-banner"
      className={`rounded-xl bg-[#181818] border border-neutral-800 p-3 sm:p-3.5 shadow-xl relative overflow-hidden text-neutral-200 transition-all ${className}`}
    >
      {/* Sleek Compact Main Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        {/* Left: Icon, Label, and IP Monospace Box */}
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/80 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
            <Smartphone className="w-4 h-4" />
          </div>

          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-xs sm:text-sm font-bold text-white shrink-0">
              Acesso no Celular:
            </span>

            {/* Address Box */}
            <div className="bg-black/80 border border-neutral-700/90 rounded-lg px-2.5 py-1 flex items-center gap-2 max-w-full">
              <span className="font-mono text-xs sm:text-sm text-emerald-400 font-bold truncate select-all">
                {activeUrl}
              </span>

              {/* Multiple IP selector */}
              {networkInfo && networkInfo.addresses.length > 1 && (
                <select
                  value={selectedIpIndex}
                  onChange={(e) => setSelectedIpIndex(Number(e.target.value))}
                  className="bg-neutral-800 text-neutral-300 text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 outline-none cursor-pointer shrink-0"
                  title="Múltiplas placas de rede detectadas"
                >
                  {networkInfo.addresses.map((ip, idx) => (
                    <option key={ip} value={idx}>
                      IP {idx + 1}: {ip}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <span className="hidden xl:inline-flex items-center gap-1 text-[11px] text-emerald-400/90 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-full font-mono">
              <Wifi className="w-3 h-3 animate-pulse" /> Same Wi-Fi
            </span>
          </div>
        </div>

        {/* Right: Quick Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow active:scale-95 cursor-pointer"
            title="Copiar link para a área de transferência"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-white" />
                <span>Copiado!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar</span>
              </>
            )}
          </button>

          {/* Expand Instructions Toggle */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 hover:text-white text-xs font-semibold transition cursor-pointer"
            title="Ver instruções passo a passo"
          >
            <span>Instruções</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-amber-400" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {onCloseBanner && (
            <button
              type="button"
              onClick={onCloseBanner}
              className="text-neutral-500 hover:text-neutral-300 p-1 text-xs"
              title="Ocultar aviso"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Expanded Instructions Accordion */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-neutral-800/80 space-y-3 text-xs animate-in fade-in duration-150">
          {/* Mode Switcher Tabs */}
          <div className="flex items-center space-x-2 border-b border-neutral-800 pb-2">
            <button
              type="button"
              onClick={() => setAccessMode('local')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer text-xs ${
                accessMode === 'local'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Na mesma rede Wi-Fi</span>
            </button>

            <button
              type="button"
              onClick={() => setAccessMode('remote')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer text-xs ${
                accessMode === 'remote'
                  ? 'bg-sky-600 text-white shadow'
                  : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Fora de Casa (4G / 5G / Viagem)</span>
              <span className="px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-300 text-[9px] uppercase font-bold">
                Novo
              </span>
            </button>
          </div>

          {accessMode === 'local' ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                <div className="p-2.5 rounded-lg bg-neutral-900/90 border border-neutral-800 space-y-0.5">
                  <div className="font-bold text-white flex items-center space-x-1.5">
                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-mono">
                      1
                    </span>
                    <span>Mesmo Wi-Fi</span>
                  </div>
                  <p className="text-neutral-400 text-[11px] leading-relaxed">
                    Conecte o celular na mesma rede Wi-Fi do computador onde o CineLocal está rodando.
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-neutral-900/90 border border-neutral-800 space-y-0.5">
                  <div className="font-bold text-white flex items-center space-x-1.5">
                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-mono">
                      2
                    </span>
                    <span>Navegador do Celular</span>
                  </div>
                  <p className="text-neutral-400 text-[11px] leading-relaxed">
                    Abra o Chrome, Safari ou Firefox e acesse <strong className="text-emerald-400 font-mono">{activeUrl}</strong>.
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-neutral-900/90 border border-neutral-800 space-y-0.5">
                  <div className="font-bold text-white flex items-center space-x-1.5">
                    <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-mono">
                      3
                    </span>
                    <span>Aviso de Certificado (HTTPS)</span>
                  </div>
                  <p className="text-neutral-400 text-[11px] leading-relaxed">
                    Se aparecer <em>"Conexão não é privada"</em>, clique em <strong className="text-amber-300">Avançado</strong> e selecione <strong className="text-amber-300">Ir para o site assim mesmo</strong>.
                  </p>
                </div>
              </div>

              {/* Certificate & Firewall details toggle */}
              <div className="flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  onClick={() => setShowHelpDetails(!showHelpDetails)}
                  className="text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer font-medium transition-colors"
                >
                  <Info className="w-3.5 h-3.5 text-sky-400" />
                  <span>Dúvidas sobre o aviso de certificado ou firewall?</span>
                  {showHelpDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              {showHelpDetails && (
                <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-900/40 text-amber-200/90 text-xs space-y-1.5 animate-in fade-in duration-150">
                  <div className="font-bold text-amber-300 flex items-center gap-1.5 text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Sobre o Certificado HTTPS Local e Firewall:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-neutral-300">
                    <li>
                      O CineLocal usa um certificado HTTPS local para segurança da rede doméstica sem depender de servidores na nuvem.
                    </li>
                    <li>
                      No Chrome/Safari do celular: clique em <strong>Avançado</strong> &gt; <strong>Continuar para {activeUrl}</strong>.
                    </li>
                    <li>
                      Opcional: instale o certificado CA em <code className="text-amber-300">certs/cinelocal.crt</code> nas configurações de segurança do celular.
                    </li>
                    <li>
                      Se não carregar, verifique se o Firewall do Windows permitiu o Node.js nas redes Privada e Pública.
                    </li>
                  </ul>
                </div>
              )}
            </>
          ) : (
            /* Remote Access Guide (Outside Home / 4G / 5G) */
            <div className="space-y-3 text-xs animate-in fade-in duration-150">
              <div className="p-3 rounded-lg bg-sky-950/30 border border-sky-800/50 text-sky-200 space-y-1">
                <div className="font-bold text-sky-300 flex items-center space-x-1.5 text-sm">
                  <Globe className="w-4 h-4 text-sky-400" />
                  <span>Como assistir de qualquer lugar do mundo (4G / 5G / Wi-Fi Externo)</span>
                </div>
                <p className="text-[11px] text-neutral-300 leading-relaxed">
                  Como o CineLocal roda no seu computador de casa, para assistir fora de casa você precisa conectar seu celular ao seu PC usando uma das 3 opções gratuitas abaixo:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Option 1: Tailscale */}
                <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-white flex items-center space-x-1 text-xs">
                        <Shield className="w-4 h-4 text-emerald-400" />
                        <span>1. Tailscale (Recomendado)</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold">
                        Mais Fácil & Seguro
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed space-y-1">
                      Cria uma rede privada virtual e criptografada entre seu PC e celular sem mexer no roteador.
                    </p>
                    <ol className="list-decimal list-inside text-[11px] text-neutral-300 space-y-1 mt-2">
                      <li>Instale o app <strong>Tailscale</strong> no PC e no Celular.</li>
                      <li>Faça login com a mesma conta em ambos.</li>
                      <li>Copie o IP do seu PC no Tailscale (ex: <code className="text-emerald-400 font-mono">100.x.y.z</code>).</li>
                      <li>Acesse no 4G: <strong className="text-emerald-400 font-mono">https://100.x.y.z:3050</strong></li>
                    </ol>
                  </div>
                  <a
                    href="https://tailscale.com"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 text-center py-1.5 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sky-400 hover:text-sky-300 font-medium text-[11px] flex items-center justify-center space-x-1 border border-neutral-700 transition"
                  >
                    <span>Baixar Tailscale Grátis</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Option 2: Cloudflare Tunnel */}
                <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-white flex items-center space-x-1 text-xs">
                        <Cloud className="w-4 h-4 text-amber-400" />
                        <span>2. Cloudflare Tunnel</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-bold">
                        Sem App no Celular
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed">
                      Cria um link HTTPS público seguro para seu PC local rodando um único comando.
                    </p>
                    <ol className="list-decimal list-inside text-[11px] text-neutral-300 space-y-1 mt-2">
                      <li>Baixe o <strong className="text-amber-300">cloudflared.exe</strong> no PC.</li>
                      <li>No CMD, rode: <code className="text-amber-300 font-mono block my-0.5 bg-black/60 p-1 rounded text-[10px]">cloudflared tunnel --url https://localhost:3050</code></li>
                      <li>Copie o link gerado (ex: <code className="text-amber-300 font-mono">https://abc.trycloudflare.com</code>).</li>
                      <li>Abra no celular em qualquer lugar.</li>
                    </ol>
                  </div>
                  <a
                    href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 text-center py-1.5 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-amber-400 hover:text-amber-300 font-medium text-[11px] flex items-center justify-center space-x-1 border border-neutral-700 transition"
                  >
                    <span>Ver Cloudflare Tunnel</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Option 3: Port Forwarding / Router */}
                <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-white flex items-center space-x-1 text-xs">
                        <Server className="w-4 h-4 text-purple-400" />
                        <span>3. Port Forwarding + DDNS</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 text-[10px] font-bold">
                        Avançado
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed">
                      Redirecionamento tradicional de porta no roteador da sua casa.
                    </p>
                    <ol className="list-decimal list-inside text-[11px] text-neutral-300 space-y-1 mt-2">
                      <li>Acesse o painel do seu roteador (ex: <code className="text-purple-300 font-mono">192.168.1.1</code>).</li>
                      <li>Abra a porta <strong className="text-purple-300 font-mono">3050</strong> para o IP do seu PC.</li>
                      <li>Configure um DDNS gratuito (ex: <strong className="text-purple-300">DuckDNS.org</strong>).</li>
                      <li>Acesse via seu domínio/IP público no 4G.</li>
                    </ol>
                  </div>
                  <a
                    href="https://www.duckdns.org"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 text-center py-1.5 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-purple-400 hover:text-purple-300 font-medium text-[11px] flex items-center justify-center space-x-1 border border-neutral-700 transition"
                  >
                    <span>Acessar DuckDNS</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
