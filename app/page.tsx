import { SessionStatus } from "@/components/session-status";

/** Three-panel shell: chat, results/pipeline, action log. Panels are filled in later phases. */
export default function Home() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Offer Desk</h1>
        <SessionStatus />
      </header>

      <main className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(280px,1fr)_2fr_minmax(260px,1fr)]">
        <Panel title="Chat">Ask for jobs in plain English. Coming in Phase 4.</Panel>
        <Panel title="Results">Ranked postings and your pipeline will show here.</Panel>
        <Panel title="Action log">Every action the agent takes will be listed here.</Panel>
      </main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col overflow-y-auto border-b border-zinc-200 p-4 md:border-b-0 md:border-r dark:border-zinc-800">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">{title}</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{children}</p>
    </section>
  );
}
