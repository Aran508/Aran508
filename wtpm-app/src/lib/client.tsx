'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

export async function fetchJson<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  });
  if (res.status === 401 && typeof window !== 'undefined' && !url.includes('/api/auth/login')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new ApiError(401, 'Session expired');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  return data as T;
}

// ---------------------------------------------------------------- live updates (SSE)
type Listener = (e: { type?: string; action?: string }) => void;
interface LiveCtx {
  status: 'connecting' | 'live' | 'offline';
  subscribe: (l: Listener) => () => void;
  lastEvent: number;
}
const Live = createContext<LiveCtx>({ status: 'offline', subscribe: () => () => undefined, lastEvent: 0 });

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LiveCtx['status']>('connecting');
  const [lastEvent, setLastEvent] = useState(0);
  const listeners = useRef(new Set<Listener>());
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const open = () => {
      es = new EventSource('/api/stream');
      es.addEventListener('ready', () => {
        attempts = 0;
        setStatus('live');
      });
      es.addEventListener('change', (ev) => {
        setLastEvent(Date.now());
        let payload = {};
        try { payload = JSON.parse((ev as MessageEvent).data); } catch { /* ignore */ }
        listeners.current.forEach((l) => l(payload));
      });
      es.onerror = () => {
        setStatus('offline');
        es?.close();
        retry = setTimeout(open, Math.min(30000, 2000 * 2 ** attempts++));
      };
    };
    open();
    // Fallback: controlled refresh every 60 s even if the live channel is blocked by a proxy
    const poll = setInterval(() => listeners.current.forEach((l) => l({ type: 'poll' })), 60000);
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
      clearInterval(poll);
    };
  }, []);
  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => listeners.current.delete(l);
  }, []);
  const value = useMemo(() => ({ status, subscribe, lastEvent }), [status, subscribe, lastEvent]);
  return <Live.Provider value={value}>{children}</Live.Provider>;
}
export const useLive = () => useContext(Live);

/** GET a JSON endpoint and re-fetch automatically whenever any user saves data. */
export function useApi<T>(url: string | null, opts: { live?: boolean } = { live: true }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [refreshing, setRefreshing] = useState(false);
  const { subscribe } = useLive();
  const urlRef = useRef(url);
  urlRef.current = url;
  const seq = useRef(0);
  const load = useCallback(async (silent = false) => {
    const u = urlRef.current;
    if (!u) return;
    const my = ++seq.current;
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const d = await fetchJson<T>(u);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);
  useEffect(() => {
    if (url) load(false);
  }, [url, load]);
  useEffect(() => {
    if (opts.live === false) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribe(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => load(true), 500);
    });
    return () => {
      unsub();
      if (t) clearTimeout(t);
    };
  }, [subscribe, load, opts.live]);
  return { data, error, loading, refreshing, reload: () => load(true), setData };
}

// ---------------------------------------------------------------- toasts
interface Toast { id: number; tone: 'good' | 'bad' | 'info'; text: string }
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[min(92vw,460px)] no-print" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg text-white ${t.tone === 'good' ? 'bg-good' : t.tone === 'bad' ? 'bg-bad' : 'bg-navy-800'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- session / meta
export interface MetaData {
  machines: { id: number; code: string; name: string; line: string; category: string; sort_order: number; active: boolean }[];
  shifts: { id: number; name: string; timings: string; total_minutes: number; lunch_minutes: number; tea_minutes: number; tpm_minutes: number; planned_minutes: number }[];
  categories: { code: string; name: string; excel_column: string; oee_group: 'A' | 'P' | 'Q' | 'M'; section: 'process' | 'management'; is_management: boolean; is_revised_excl: boolean; requires_reason: boolean; is_common: boolean; sort_order: number }[];
  settings: Record<string, unknown>;
  user: { uid: number; username: string; name: string; role: 'operator' | 'supervisor' | 'management' | 'admin' };
  permissions: string[];
  serverToday: string;
}
const MetaCtx = createContext<{ meta: MetaData | null; reload: () => void }>({ meta: null, reload: () => undefined });
export function MetaProvider({ children }: { children: React.ReactNode }) {
  const { data, reload } = useApi<MetaData>('/api/meta');
  useEffect(() => {
    // master data edits elsewhere are picked up by useApi's live refresh
  }, []);
  return <MetaCtx.Provider value={{ meta: data, reload }}>{children}</MetaCtx.Provider>;
}
export const useMeta = () => useContext(MetaCtx);
export const useCan = () => {
  const { meta } = useMeta();
  return (p: string) => !!meta?.permissions.includes(p);
};

/** Keep a value in sync with the URL query string (filters survive reloads and can be shared). */
export function useQueryState(key: string, initial: string): [string, (v: string) => void] {
  const [v, setV] = useState(initial);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get(key);
    if (q != null) setV(q);
  }, [key]);
  const set = useCallback(
    (nv: string) => {
      setV(nv);
      const u = new URL(window.location.href);
      if (nv) u.searchParams.set(key, nv);
      else u.searchParams.delete(key);
      window.history.replaceState(null, '', u.toString());
    },
    [key],
  );
  return [v, set];
}
