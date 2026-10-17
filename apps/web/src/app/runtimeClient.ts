import type { ProjectData } from './useProjectData';

const DEFAULT_RUNTIME_BASE_URL_KEY = 'design_viewer_runtime_base_url';
const LEGACY_RUNTIME_BASE_URL_KEYS: string[] = [];
const DEFAULT_RUNTIME_EVENTS_PATH = '/ops/events';
const DEFAULT_RUNTIME_OUTBOX_PATH = '/ops/outbox';
const DEFAULT_RUNTIME_FLOW_RECENT_PATH = '/ops/flows/:id/recent';

export type RuntimePaths = {
  events: string;
  outbox: string;
  flowRecent: string;
};

function resolveRuntimeBaseUrlStorageKey(): string {
  const configured = (import.meta.env.VITE_DV_RUNTIME_STORAGE_KEY ?? '').trim();
  return configured || DEFAULT_RUNTIME_BASE_URL_KEY;
}

const RUNTIME_BASE_URL_KEY = resolveRuntimeBaseUrlStorageKey();
const RUNTIME_BASE_URL_CHANGE_EVENT = `${RUNTIME_BASE_URL_KEY}_changed`;

type RuntimeFetchResult<T> = {
  data: T | null;
  error: string | null;
  status: number | null;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function joinRuntimeUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readRuntimeBaseUrlRaw(): string | null {
  const primary = window.localStorage.getItem(RUNTIME_BASE_URL_KEY);
  if (primary) {
    return primary;
  }

  for (const legacyKey of LEGACY_RUNTIME_BASE_URL_KEYS) {
    const value = window.localStorage.getItem(legacyKey);
    if (value) {
      return value;
    }
  }
  return null;
}

export function getRuntimeBaseUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const value = readRuntimeBaseUrlRaw();
  if (!value) {
    return null;
  }
  const normalized = normalizeBaseUrl(value);
  return normalized || null;
}

export function setRuntimeBaseUrl(value: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const normalized = normalizeBaseUrl(value);
  if (normalized) {
    window.localStorage.setItem(RUNTIME_BASE_URL_KEY, normalized);
  } else {
    window.localStorage.removeItem(RUNTIME_BASE_URL_KEY);
  }
  window.dispatchEvent(new Event(RUNTIME_BASE_URL_CHANGE_EVENT));
}

export function subscribeRuntimeBaseUrl(
  listener: (value: string | null) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleCustomEvent = () => listener(getRuntimeBaseUrl());
  const handleStorageEvent = (event: StorageEvent) => {
    if (
      event.key === RUNTIME_BASE_URL_KEY ||
      LEGACY_RUNTIME_BASE_URL_KEYS.includes(event.key ?? '')
    ) {
      listener(getRuntimeBaseUrl());
    }
  };

  window.addEventListener(RUNTIME_BASE_URL_CHANGE_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);

  return () => {
    window.removeEventListener(RUNTIME_BASE_URL_CHANGE_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
  };
}

export async function fetchRuntimeJson<T>(path: string): Promise<RuntimeFetchResult<T>> {
  const baseUrl = getRuntimeBaseUrl();
  if (!baseUrl) {
    return { data: null, error: 'Runtime base URL is not set', status: null };
  }

  const url = joinRuntimeUrl(baseUrl, path);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      return {
        data: null,
        error: `HTTP ${response.status} ${response.statusText}`,
        status: response.status,
      };
    }
    const json = (await response.json()) as T;
    return { data: json, error: null, status: response.status };
  } catch (err) {
    return {
      data: null,
      error: (err as Error).message || 'Runtime request failed',
      status: null,
    };
  }
}

export async function fetchRuntimeEvents(limit = 50, data?: ProjectData | null) {
  return fetchRuntimeJson<unknown>(`${runtimeEventsPath(data)}?limit=${limit}`);
}

export async function fetchRuntimeOutbox(status: string, limit = 200, data?: ProjectData | null) {
  const normalized = (status ?? '').trim().toUpperCase() || 'PENDING';
  return fetchRuntimeJson<unknown>(
    `${runtimeOutboxPath(data)}?status=${encodeURIComponent(normalized)}&limit=${limit}`,
  );
}

export async function fetchRuntimeFlowRecent(
  flowId: string,
  limit = 100,
  data?: ProjectData | null,
) {
  return fetchRuntimeJson<unknown>(
    `${runtimeFlowRecentPath(flowId, data)}?limit=${limit}`,
  );
}

export function toRuntimeRecords(payload: unknown): Record<string, unknown>[] {
  const candidateArrays: unknown[] = [];

  if (Array.isArray(payload)) {
    candidateArrays.push(payload);
  } else if (isRecord(payload)) {
    candidateArrays.push(
      payload.items,
      payload.records,
      payload.rows,
      payload.events,
      payload.data,
      payload.result,
    );
  }

  for (const candidate of candidateArrays) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    const rows = candidate.filter(isRecord) as Record<string, unknown>[];
    if (rows.length > 0) {
      return rows;
    }
  }

  return [];
}

export function formatRuntimeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function configuredRuntimePath(name: string, fallback: string, manifestValue?: string): string {
  const value = (import.meta.env[name] ?? '').trim();
  return value || manifestValue?.trim() || fallback;
}

export function runtimeEventsPath(data?: ProjectData | null): string {
  return configuredRuntimePath(
    'VITE_DV_RUNTIME_EVENTS_PATH',
    DEFAULT_RUNTIME_EVENTS_PATH,
    data?.meta.policy?.runtime_paths?.events,
  );
}

export function runtimeOutboxPath(data?: ProjectData | null): string {
  return configuredRuntimePath(
    'VITE_DV_RUNTIME_OUTBOX_PATH',
    DEFAULT_RUNTIME_OUTBOX_PATH,
    data?.meta.policy?.runtime_paths?.outbox,
  );
}

export function runtimeFlowRecentPath(flowId = ':id', data?: ProjectData | null): string {
  return configuredRuntimePath(
    'VITE_DV_RUNTIME_FLOW_RECENT_PATH',
    DEFAULT_RUNTIME_FLOW_RECENT_PATH,
    data?.meta.policy?.runtime_paths?.flow_recent,
  )
    .replace(':id', encodeURIComponent(flowId));
}

export function runtimePaths(data?: ProjectData | null): RuntimePaths {
  return {
    events: runtimeEventsPath(data),
    outbox: runtimeOutboxPath(data),
    flowRecent: runtimeFlowRecentPath(':id', data),
  };
}
