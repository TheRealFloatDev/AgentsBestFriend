const API_BASE = "/api";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HealthCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export interface LlmStatus {
  provider: string;
  available: boolean;
  baseUrl?: string;
  summaryModel?: string;
  embeddingModel?: string;
  models: Array<{ name: string; size: number }>;
}

export interface IndexStatus {
  indexedFiles: number;
  totalTrackedFiles: number;
  lastUpdated: string | null;
  staleFiles: number;
  indexSizeBytes: number;
}

export interface IndexStats {
  totalDiscovered: number;
  indexed: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export interface AbfConfig {
  llm: {
    provider: string;
    ollama: { baseUrl: string; summaryModel: string; embeddingModel: string };
  };
  indexing: {
    autoWatch: boolean;
    respectGitignore: boolean;
    maxFileSizeKb: number;
    excludedPatterns: string[];
  };
  search: { defaultMaxResults: number; ripgrepPath: string };
  portal: { port: number };
}

// ─── API Calls ───────────────────────────────────────────────────────────────

export const api = {
  health: () => fetchJson<{ ok: boolean; version: string }>("/health"),

  doctor: () => fetchJson<{ checks: HealthCheck[] }>("/doctor"),

  getConfig: () => fetchJson<AbfConfig>("/config"),

  updateConfig: (partial: Partial<AbfConfig>) =>
    fetchJson<AbfConfig>("/config", {
      method: "PUT",
      body: JSON.stringify(partial),
    }),

  llmStatus: () => fetchJson<LlmStatus>("/llm/status"),

  projectStatus: (projectPath: string) =>
    fetchJson<IndexStatus>(
      `/projects/${encodeURIComponent(projectPath)}/status`,
    ),

  projectReindex: (projectPath: string) =>
    fetchJson<IndexStats>(
      `/projects/${encodeURIComponent(projectPath)}/index`,
      { method: "POST" },
    ),
};
