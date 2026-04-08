import { useState, useEffect } from "react";
import { DashboardPage } from "./pages/Dashboard";
import { ConfigPage } from "./pages/Config";

const PAGES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "config", label: "Configuration" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

function getPageFromHash(): PageId {
  const hash = window.location.hash.slice(1);
  if (PAGES.some((p) => p.id === hash)) return hash as PageId;
  return "dashboard";
}

export function App() {
  const [page, setPage] = useState<PageId>(getPageFromHash);

  useEffect(() => {
    const handler = () => setPage(getPageFromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  function navigate(id: PageId) {
    window.location.hash = id;
    setPage(id);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-zinc-800 p-4 flex flex-col gap-1 shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 mb-4">
          <span className="text-lg font-bold tracking-tight">abf</span>
          <span className="text-xs text-zinc-500 font-mono">v0.1.0</span>
        </div>

        {PAGES.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(p.id)}
            className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              page === p.id
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            {p.label}
          </button>
        ))}

        <div className="mt-auto pt-4 border-t border-zinc-800">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-600 hover:text-zinc-400 px-3"
          >
            AgentsBestFriend
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 max-w-4xl">
        {page === "dashboard" && <DashboardPage />}
        {page === "config" && <ConfigPage />}
      </main>
    </div>
  );
}
