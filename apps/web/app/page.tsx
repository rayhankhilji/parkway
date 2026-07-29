export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8">
        <h1 className="text-2xl font-semibold">Parkway</h1>
        <p className="mt-3 text-base text-text-muted">
          A property-trading board game for you and up to five friends. Create a game, share the
          room code, play in the browser.
        </p>
        <p className="mt-6 text-sm text-text-faint">
          Creating and joining games arrives with the lobby.
        </p>
      </div>
    </main>
  );
}
