// API URL è gestito tramite proxy (rewrites) in next.config.ts per evitare problemi di CORS e firewall

export function getSettings() {
  if (typeof window === 'undefined') return {};
  try {
    const data = localStorage.getItem('teletransport_settings');
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

export async function fetchConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export async function fetchTrains(payload: any, signal?: AbortSignal) {
  const settings = getSettings();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  if (settings.treni) {
    headers['X-Config'] = JSON.stringify({ treni: settings.treni });
  }

  const res = await fetch(`/api/trains`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const detail = errorData.detail;
    const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
    throw new Error(msg || 'Errore nella ricerca dei treni');
  }
  
  return res.json();
}

export async function fetchFlights(payload: any, signal?: AbortSignal) {
  const settings = getSettings();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  if (settings.serpapiKey) {
    headers['X-SerpApi-Key'] = settings.serpapiKey;
  }
  
  if (settings.voli) {
    headers['X-Config'] = JSON.stringify({ voli: settings.voli });
  }

  const res = await fetch(`/api/flights`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const detail = errorData.detail;
    const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
    throw new Error(msg || 'Errore nella ricerca dei voli');
  }
  
  return res.json();
}
