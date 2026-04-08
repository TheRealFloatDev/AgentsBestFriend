import { api } from "../api";
import { useAsync } from "../hooks";

export function DashboardPage() {
  const doctor = useAsync(() => api.doctor());
  const llm = useAsync(() => api.llmStatus());

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Dashboard</h2>
        <p className="text-zinc-400 text-sm">System overview</p>
      </div>

      {/* Health Checks */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <h3 className="text-lg font-medium mb-4">Health Checks</h3>
        {doctor.loading && <Skeleton />}
        {doctor.error && <ErrorBox message={doctor.error} />}
        {doctor.data && (
          <div className="space-y-2">
            {doctor.data.checks.map((check) => (
              <div key={check.name} className="flex items-center gap-3 text-sm">
                <StatusDot status={check.status} />
                <span className="font-medium w-32">{check.name}</span>
                <span className="text-zinc-400">{check.message}</span>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={doctor.refresh}
          className="mt-4 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Re-check
        </button>
      </section>

      {/* LLM Status */}
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <h3 className="text-lg font-medium mb-4">LLM Provider</h3>
        {llm.loading && <Skeleton />}
        {llm.error && <ErrorBox message={llm.error} />}
        {llm.data && (
          <div className="space-y-2 text-sm">
            <Row label="Provider" value={llm.data.provider} />
            <Row
              label="Status"
              value={
                llm.data.available ? (
                  <span className="text-emerald-400">Connected</span>
                ) : (
                  <span className="text-amber-400">Unavailable</span>
                )
              }
            />
            {llm.data.baseUrl && (
              <Row label="Base URL" value={llm.data.baseUrl} />
            )}
            {llm.data.summaryModel && (
              <Row label="Summary Model" value={llm.data.summaryModel} />
            )}
            {llm.data.embeddingModel && (
              <Row label="Embedding Model" value={llm.data.embeddingModel} />
            )}
            {llm.data.models.length > 0 && (
              <Row
                label="Installed Models"
                value={llm.data.models.map((m) => m.name).join(", ")}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusDot({ status }: { status: "ok" | "warn" | "error" }) {
  const color =
    status === "ok"
      ? "bg-emerald-400"
      : status === "warn"
        ? "bg-amber-400"
        : "bg-red-400";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="text-zinc-500 w-40 shrink-0">{label}</span>
      <span className="text-zinc-200">{value}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-4 bg-zinc-800 rounded w-3/4" />
      <div className="h-4 bg-zinc-800 rounded w-1/2" />
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3 text-sm text-red-300">
      {message}
    </div>
  );
}
