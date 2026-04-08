import { useState } from "react";
import { api, type AbfConfig } from "../api";
import { useAsync } from "../hooks";

export function ConfigPage() {
  const config = useAsync(() => api.getConfig());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave(partial: Partial<AbfConfig>) {
    setSaving(true);
    setMessage(null);
    try {
      await api.updateConfig(partial);
      setMessage("Saved!");
      config.refresh();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Configuration</h2>
        <p className="text-zinc-400 text-sm">
          Global settings stored at{" "}
          <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">
            ~/.abf/config.json
          </code>
        </p>
      </div>

      {config.loading && <div className="text-zinc-500">Loading...</div>}
      {config.error && (
        <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3 text-sm text-red-300">
          {config.error}
        </div>
      )}
      {config.data && (
        <ConfigForm config={config.data} onSave={handleSave} saving={saving} />
      )}

      {message && (
        <div
          className={`text-sm ${message.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}
        >
          {message}
        </div>
      )}
    </div>
  );
}

function ConfigForm({
  config,
  onSave,
  saving,
}: {
  config: AbfConfig;
  onSave: (partial: Partial<AbfConfig>) => void;
  saving: boolean;
}) {
  const [provider, setProvider] = useState(config.llm.provider);
  const [baseUrl, setBaseUrl] = useState(config.llm.ollama.baseUrl);
  const [summaryModel, setSummaryModel] = useState(
    config.llm.ollama.summaryModel,
  );
  const [embeddingModel, setEmbeddingModel] = useState(
    config.llm.ollama.embeddingModel,
  );
  const [port, setPort] = useState(String(config.portal.port));
  const [maxFileSize, setMaxFileSize] = useState(
    String(config.indexing.maxFileSizeKb),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      llm: {
        provider: provider as "ollama" | "none",
        ollama: { baseUrl, summaryModel, embeddingModel },
      },
      portal: { port: parseInt(port, 10) },
      indexing: {
        ...config.indexing,
        maxFileSizeKb: parseInt(maxFileSize, 10),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* LLM Section */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
        <h3 className="text-lg font-medium">LLM Provider</h3>

        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm w-full"
          >
            <option value="ollama">Ollama (local)</option>
            <option value="none">None (disabled)</option>
          </select>
        </Field>

        {provider === "ollama" && (
          <>
            <Field label="Base URL">
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm w-full"
              />
            </Field>
            <Field label="Summary Model">
              <input
                value={summaryModel}
                onChange={(e) => setSummaryModel(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm w-full"
              />
            </Field>
            <Field label="Embedding Model">
              <input
                value={embeddingModel}
                onChange={(e) => setEmbeddingModel(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm w-full"
              />
            </Field>
          </>
        )}
      </section>

      {/* Indexing Section */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
        <h3 className="text-lg font-medium">Indexing</h3>
        <Field label="Max File Size (KB)">
          <input
            type="number"
            value={maxFileSize}
            onChange={(e) => setMaxFileSize(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm w-40"
          />
        </Field>
      </section>

      {/* Portal Section */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
        <h3 className="text-lg font-medium">Portal</h3>
        <Field label="Port">
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm w-40"
          />
        </Field>
      </section>

      <button
        type="submit"
        disabled={saving}
        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        {saving ? "Saving..." : "Save Configuration"}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
