const CAST_AVAILABILITY_EVENT = 'cinelocal-cast-available';

let castConfigured = false;

export function getCastContext(): any | null {
  if (typeof window === 'undefined') return null;

  const browserWindow = window as any;
  const castFramework = browserWindow.cast?.framework;
  const chromeCast = browserWindow.chrome?.cast;

  if (!castFramework?.CastContext || !chromeCast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID) {
    return null;
  }

  const context = castFramework.CastContext.getInstance();
  if (!castConfigured) {
    const options: Record<string, unknown> = {
      receiverApplicationId: chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    };
    if (chromeCast.AutoJoinPolicy?.ORIGIN_SCOPED) {
      options.autoJoinPolicy = chromeCast.AutoJoinPolicy.ORIGIN_SCOPED;
    }
    context.setOptions(options);
    castConfigured = true;
  }

  return context;
}

export function subscribeToCastAvailability(onChange: (context: any | null) => void): () => void {
  let lastContext: any | null | undefined;
  let pollTimer: number | null = null;
  let stopTimer: number | null = null;

  const stopPolling = () => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (stopTimer !== null) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
  };

  const notify = () => {
    const context = getCastContext();
    if (context) stopPolling();
    if (context === lastContext) return;
    lastContext = context;
    onChange(context);
  };

  window.addEventListener(CAST_AVAILABILITY_EVENT, notify);
  notify();

  // On mobile Chrome the Cast SDK can finish loading after the callback above
  // has already fired. Keep checking briefly so the player does not miss it.
  if (!lastContext) {
    pollTimer = window.setInterval(notify, 250);
    stopTimer = window.setTimeout(stopPolling, 30000);
  }

  return () => {
    stopPolling();
    window.removeEventListener(CAST_AVAILABILITY_EVENT, notify);
  };
}

/**
 * Chromecast cannot resolve the sender's localhost. Ask the server for LAN
 * addresses and, when HTTPS is enabled, use its HTTP media port so the
 * receiver does not have to validate the local self-signed certificate.
 */
export async function resolveCastBaseUrls(): Promise<string[]> {
  const fallback = [window.location.origin];

  try {
    const response = await fetch('/api/system/cast-info');
    if (!response.ok) return fallback;

    const data = await response.json();
    const protocol = typeof data.protocol === 'string' ? data.protocol : '';
    const port = Number(data.port);
    const addresses = Array.isArray(data.addresses) ? data.addresses : [];

    if (!protocol || !port) return fallback;

    const urls = addresses
      .filter((address: unknown): address is string => typeof address === 'string' && address.length > 0)
      .map((address: string) => `${protocol}://${address}:${port}`);

    return urls.length > 0 ? urls : fallback;
  } catch {
    return fallback;
  }
}

export function getCastErrorMessage(error: unknown): string {
  const code = (error as any)?.code || (error as any)?.errorCode;
  if (code === 'cancel' || code === 'CANCEL') return 'A conexão com o Chromecast foi cancelada.';
  if (code === 'receiver_unavailable' || code === 'RECEIVER_UNAVAILABLE') {
    return 'Nenhum Chromecast disponível. Verifique se o dispositivo está na mesma rede.';
  }
  if (typeof (error as any)?.message === 'string' && (error as any).message.trim()) {
    return (error as any).message;
  }
  return 'Não foi possível iniciar a transmissão para o Chromecast.';
}
