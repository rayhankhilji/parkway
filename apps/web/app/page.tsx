import { LandingForms } from '@/components/LandingForms';
import { SmallScreenNotice } from '@/components/SmallScreenNotice';

export default function HomePage() {
  return (
    <>
      <SmallScreenNotice />

      <main className="hidden min-h-screen flex-col items-center justify-center gap-8 p-6 md:flex">
        <header className="text-center">
          <h1 className="text-2xl font-semibold">Parkway</h1>
          <p className="mt-2 max-w-sm text-base text-text-muted">
            A property-trading board game for two to six friends. Share the room code, play in the
            browser. No accounts.
          </p>
        </header>

        <LandingForms />

        <p className="text-sm text-text-faint">
          Your seat is kept in this browser. Clear its storage and you lose the seat.
        </p>
      </main>
    </>
  );
}
