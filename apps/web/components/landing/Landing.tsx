'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Difficulty } from '@parkway/bot';
import { Token } from '@/components/board/TokenLayer';
import { Mark } from '@/components/game/TopBar';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ChoiceField, TextField, ToggleField } from '@/components/ui/Field';
import { createGameRequest, joinGameRequest, type ApiFailure } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import {
  playerColours,
  resumableLocal,
  type LocalSave,
  type PlayerColour,
} from '@/lib/local/localGame';
import { isRoomCode, normaliseRoomCode, roomCodeLength } from '@/lib/roomCode';
import { loadSession, saveSession } from '@/lib/session';
import { sfx } from '@/lib/sound';
import { useGameStore } from '@/store/useGameStore';
import { DemoBoard } from './DemoBoard';

const nameKey = 'parkway:name';

function rememberedName(): string {
  try {
    return window.localStorage.getItem(nameKey) ?? '';
  } catch {
    return '';
  }
}

function rememberName(name: string): void {
  try {
    window.localStorage.setItem(nameKey, name);
  } catch {
    // Not remembered next time; nothing else depends on it.
  }
}

export function Landing() {
  const params = useSearchParams();
  const [sheet, setSheet] = useState<'solo' | 'online' | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [resume, setResume] = useState<LocalSave | null>(null);
  const router = useRouter();

  useEffect(() => {
    setResume(resumableLocal());
    const join = params.get('join');
    if (join !== null) {
      setJoinCode(normaliseRoomCode(join));
      setSheet('online');
    } else if (params.get('new') === 'solo') {
      setSheet('solo');
    }
  }, [params]);

  return (
    <div className="felt relative min-h-dvh overflow-x-hidden">
      <header className="relative z-10 mx-auto flex h-16 max-w-6xl items-center gap-2 px-5">
        <Mark className="size-8" />
        <span className="font-display text-2xl font-black italic tracking-tight">Parkway</span>
      </header>

      <main className="relative z-10 mx-auto grid max-w-6xl items-center gap-6 px-5 pb-16 pt-0 sm:gap-10 lg:grid-cols-[1fr_1.05fr] lg:pt-10">
        <section className="flex flex-col items-start">
          <p className="animate-fade-up rounded-full bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold ring-1 ring-gold/30 sm:text-xs">
            The property game, beautifully made
          </p>
          <h1 className="mt-5 animate-fade-up font-display text-5xl font-black leading-[0.95] tracking-tight [animation-delay:60ms] sm:text-7xl">
            Buy the streets.
            <br />
            <span className="gold-text italic">Bankrupt</span> your friends.
          </h1>
          <p className="mt-5 max-w-md animate-fade-up text-lg text-text-muted [animation-delay:120ms]">
            The classic trading game in the city of Ashvale. Play the computer right now, or share a
            code and play with up to five friends. No accounts, no downloads.
          </p>

          <div className="mt-8 flex w-full animate-fade-up flex-col gap-3 [animation-delay:180ms] sm:w-auto sm:flex-row">
            {resume !== null && (
              <Button
                variant="primary"
                size="xl"
                onClick={() => {
                  sfx.click();
                  router.push('/play');
                }}
              >
                Continue your game
              </Button>
            )}
            <Button
              variant={resume === null ? 'primary' : 'secondary'}
              size="xl"
              onClick={() => {
                sfx.click();
                setSheet('solo');
              }}
            >
              {resume === null ? 'Play vs computer' : 'New solo game'}
            </Button>
            <Button
              variant="secondary"
              size="xl"
              onClick={() => {
                sfx.click();
                setSheet('online');
              }}
            >
              Play with friends
            </Button>
          </div>

          <ul className="mt-10 grid w-full max-w-lg animate-fade-up grid-cols-3 gap-3 text-sm [animation-delay:240ms]">
            {[
              ['Every rule', 'Auctions, mortgages, trades, jail — all of it.'],
              ['Clever bots', 'Four levels, from gentle to ruthless.'],
              ['Any screen', 'Phone, tablet or desktop.'],
            ].map(([title, body]) => (
              <li
                key={title}
                className="rounded-2xl bg-black/20 p-3 ring-1 ring-inset ring-white/5"
              >
                <p className="font-semibold text-text">{title}</p>
                <p className="mt-0.5 text-xs leading-snug text-text-faint">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="relative order-first mx-auto -mb-6 w-full max-w-[300px] animate-fade-up [animation-delay:120ms] [perspective:1800px] sm:max-w-[420px] lg:order-none lg:mb-0 lg:max-w-[560px]">
          <div className="animate-bob">
            <div className="[transform:rotateX(38deg)_rotateZ(-14deg)] [transform-style:preserve-3d]">
              <DemoBoard />
            </div>
          </div>
        </section>
      </main>

      <SoloSetup open={sheet === 'solo'} onClose={() => setSheet(null)} />
      <OnlineSetup
        open={sheet === 'online'}
        onClose={() => setSheet(null)}
        initialCode={joinCode}
      />
    </div>
  );
}

/* ---- Solo ---------------------------------------------------------------- */

const difficulties: readonly { value: Difficulty; label: string; blurb: string }[] = [
  { value: 'gentle', label: 'Gentle', blurb: 'Relaxed. Makes the odd blunder.' },
  { value: 'steady', label: 'Steady', blurb: 'Plays sensibly. A fair game.' },
  { value: 'sharp', label: 'Sharp', blurb: 'Hunts sets and plays the Gaol well.' },
  { value: 'ruthless', label: 'Ruthless', blurb: 'Overbids for monopolies. No mercy.' },
];

function SoloSetup({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const router = useRouter();
  const startLocal = useGameStore((s) => s.startLocal);
  const [name, setName] = useState('');
  const [colour, setColour] = useState<PlayerColour>('rose');
  const [opponents, setOpponents] = useState(3);
  const [difficulty, setDifficulty] = useState<Difficulty>('steady');
  const [rules, setRules] = useState(false);
  const [startingCash, setStartingCash] = useState(1500);
  const [salary, setSalary] = useState(200);
  const [auctionSeconds, setAuctionSeconds] = useState(12);
  const [freeParkingPot, setFreeParkingPot] = useState(false);
  const [auctionOnDecline, setAuctionOnDecline] = useState(true);

  useEffect(() => {
    if (open && name === '') setName(rememberedName());
  }, [open, name]);

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 20;

  const start = () => {
    if (!valid) return;
    rememberName(trimmed);
    sfx.yourTurn();
    startLocal({
      name: trimmed,
      colour,
      opponents,
      difficulty,
      config: {
        startingCash,
        salary,
        freeParkingPot,
        incomeTaxMode: 'flat',
        auctionOnDecline,
        auctionSeconds,
      },
    });
    router.push('/play');
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Play the computer"
      subtitle="A full game against bots, right here in your browser."
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full sm:w-auto"
          disabled={!valid}
          onClick={start}
        >
          Deal me in
        </Button>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <TextField
          label="Your name"
          value={name}
          maxLength={20}
          autoComplete="off"
          placeholder="Ada"
          onChange={(event) => setName(event.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">
            Your token
          </span>
          <div className="flex gap-2" role="radiogroup" aria-label="Your token">
            {playerColours.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={colour === option}
                aria-label={option}
                onClick={() => setColour(option)}
                className={cn(
                  'size-11 rounded-full p-0.5 transition active:scale-90',
                  colour === option
                    ? 'ring-2 ring-gold ring-offset-2 ring-offset-surface'
                    : 'opacity-60 hover:opacity-100',
                )}
              >
                <Token
                  colour={option}
                  initial={trimmed === '' ? '?' : trimmed}
                  labelClassName="text-lg"
                />
              </button>
            ))}
          </div>
        </div>

        <ChoiceField
          label="Opponents"
          value={opponents}
          onChange={setOpponents}
          options={[1, 2, 3, 4, 5].map((count) => ({ value: count, label: `${count}` }))}
        />

        <div className="flex flex-col gap-1.5">
          <ChoiceField
            label="Difficulty"
            value={difficulty}
            onChange={setDifficulty}
            options={difficulties.map((option) => ({ value: option.value, label: option.label }))}
          />
          <p className="text-sm text-text-faint">
            {difficulties.find((option) => option.value === difficulty)?.blurb}
          </p>
        </div>

        <div className="rounded-2xl bg-black/20 ring-1 ring-inset ring-white/5">
          <button
            type="button"
            onClick={() => setRules(!rules)}
            aria-expanded={rules}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
          >
            House rules
            <span className={cn('text-text-faint transition-transform', rules && 'rotate-180')}>
              ▾
            </span>
          </button>
          {rules && (
            <div className="flex flex-col gap-4 border-t border-white/5 p-4">
              <ChoiceField
                label="Starting cash"
                value={startingCash}
                onChange={setStartingCash}
                options={[1000, 1500, 2000].map((value) => ({
                  value,
                  label: `£${value.toLocaleString('en-GB')}`,
                }))}
              />
              <ChoiceField
                label="Salary"
                value={salary}
                onChange={setSalary}
                options={[200, 400].map((value) => ({ value, label: `£${value}` }))}
              />
              <ChoiceField
                label="Auction clock"
                value={auctionSeconds}
                onChange={setAuctionSeconds}
                options={[8, 12, 20, 30].map((value) => ({ value, label: `${value}s` }))}
              />
              <ToggleField
                label="Declined lots go to auction"
                checked={auctionOnDecline}
                onChange={setAuctionOnDecline}
              />
              <ToggleField
                label="Free-rest jackpot"
                description="Taxes and fines pile up for whoever lands on Marsh Common."
                checked={freeParkingPot}
                onChange={setFreeParkingPot}
              />
            </div>
          )}
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/* ---- Online -------------------------------------------------------------- */

// Inlined at build time. Without it the browser cannot open a live channel, so
// online rooms cannot work however the server is configured.
const onlineAvailable = Boolean(
  process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
);

function OnlineSetup({
  open,
  onClose,
  initialCode,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialCode: string | null;
}) {
  const [mode, setMode] = useState<'create' | 'join'>('create');

  useEffect(() => {
    if (initialCode !== null) setMode('join');
  }, [initialCode]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Play with friends"
      subtitle="Up to six players, each on their own device."
    >
      {!onlineAvailable && (
        <p className="mb-5 rounded-xl bg-gold/10 px-3 py-2 text-sm text-gold ring-1 ring-inset ring-gold/30">
          Online rooms are not switched on for this server yet. Playing the computer works fully.
        </p>
      )}
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1" role="tablist">
        {(['create', 'join'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mode === tab}
            onClick={() => setMode(tab)}
            className={cn(
              'h-10 rounded-lg text-sm font-semibold transition',
              mode === tab
                ? 'bg-surface-high text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            )}
          >
            {tab === 'create' ? 'Create a room' : 'Join with a code'}
          </button>
        ))}
      </div>
      {mode === 'create' ? <CreateForm /> : <JoinForm initialCode={initialCode} />}
    </Dialog>
  );
}

function Failure({ failure }: { readonly failure: ApiFailure | null }) {
  if (failure === null) return null;
  return (
    <p role="alert" className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-[#ffc2ba]">
      {failure.message}
    </p>
  );
}

function CreateForm() {
  const router = useRouter();
  const [name, setName] = useState(() => (typeof window === 'undefined' ? '' : rememberedName()));
  const [startingCash, setStartingCash] = useState(1500);
  const [auctionSeconds, setAuctionSeconds] = useState(30);
  const [freeParkingPot, setFreeParkingPot] = useState(false);
  const [auctionOnDecline, setAuctionOnDecline] = useState(true);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 20;

  async function submit(): Promise<void> {
    if (!canSubmit || pending) return;
    setPending(true);
    setFailure(null);
    rememberName(trimmed);

    const result = await createGameRequest(trimmed, {
      startingCash,
      salary: 200,
      freeParkingPot,
      incomeTaxMode: 'flat',
      auctionOnDecline,
      auctionSeconds,
    });

    if (!result.ok) {
      setFailure(result.failure);
      setPending(false);
      return;
    }

    saveSession({
      gameId: result.value.gameId,
      playerId: result.value.playerId,
      token: result.value.playerToken,
    });
    router.push(`/game/${result.value.gameId}`);
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextField
        label="Your name"
        value={name}
        maxLength={20}
        autoComplete="off"
        placeholder="Ada"
        onChange={(event) => setName(event.target.value)}
      />
      <ChoiceField
        label="Starting cash"
        value={startingCash}
        onChange={setStartingCash}
        options={[1000, 1500, 2000].map((value) => ({
          value,
          label: `£${value.toLocaleString('en-GB')}`,
        }))}
      />
      <ChoiceField
        label="Auction clock"
        value={auctionSeconds}
        onChange={setAuctionSeconds}
        options={[15, 30, 60].map((value) => ({ value, label: `${value}s` }))}
      />
      <ToggleField
        label="Declined lots go to auction"
        checked={auctionOnDecline}
        onChange={setAuctionOnDecline}
      />
      <ToggleField
        label="Free-rest jackpot"
        checked={freeParkingPot}
        onChange={setFreeParkingPot}
      />
      <Failure failure={failure} />
      <Button type="submit" variant="primary" size="lg" pending={pending} disabled={!canSubmit}>
        Create room
      </Button>
    </form>
  );
}

function JoinForm({ initialCode }: { readonly initialCode: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode ?? '');
  const [name, setName] = useState(() => (typeof window === 'undefined' ? '' : rememberedName()));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const normalised = normaliseRoomCode(code);
  const codeLooksValid = isRoomCode(normalised);
  const trimmed = name.trim();
  const canSubmit = codeLooksValid && trimmed.length > 0 && trimmed.length <= 20;

  async function submit(): Promise<void> {
    if (!canSubmit || pending) return;
    setPending(true);
    setFailure(null);
    rememberName(trimmed);

    // If this browser already holds a seat in the game behind that code, the
    // server treats the request as a reconnect rather than a new join.
    const result = await joinGameRequest(normalised, trimmed);

    if (!result.ok) {
      setFailure(result.failure);
      setPending(false);
      return;
    }

    const token = result.value.playerToken ?? loadSession(result.value.gameId)?.token;
    if (token !== undefined) {
      saveSession({ gameId: result.value.gameId, playerId: result.value.playerId, token });
    }
    router.push(`/game/${result.value.gameId}`);
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextField
        label="Room code"
        value={code}
        maxLength={roomCodeLength}
        autoComplete="off"
        spellCheck={false}
        placeholder="ABC234"
        hint="Six characters. No O, zero, I or one — they are too easy to mistake."
        error={
          code.length >= roomCodeLength && !codeLooksValid ? 'That is not a valid code.' : undefined
        }
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        className="h-14 text-center font-mono text-2xl uppercase tracking-[0.3em]"
      />
      <TextField
        label="Your name"
        value={name}
        maxLength={20}
        autoComplete="off"
        placeholder="Bo"
        onChange={(event) => setName(event.target.value)}
      />
      <Failure failure={failure} />
      <Button type="submit" variant="primary" size="lg" pending={pending} disabled={!canSubmit}>
        Join game
      </Button>
    </form>
  );
}
