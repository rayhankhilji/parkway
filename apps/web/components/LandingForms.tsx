'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { CheckField, SelectField, TextField } from '@/components/ui/Field';
import { createGameRequest, joinGameRequest, type ApiFailure } from '@/lib/apiClient';
import { isRoomCode, normaliseRoomCode, roomCodeLength } from '@/lib/roomCode';
import { loadSession, saveSession } from '@/lib/session';

/**
 * Creating a game and joining one.
 *
 * Both forms validate locally before sending — not to duplicate the server's
 * checks, but so nobody waits for a round trip to be told they typed an O where a
 * zero belongs. The server validates everything again regardless; the client's
 * copy is a courtesy and is never the authority.
 */
export function LandingForms() {
  const [mode, setMode] = useState<'create' | 'join'>('create');

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex gap-2" role="tablist" aria-label="Create or join">
        <Button
          role="tab"
          aria-selected={mode === 'create'}
          variant={mode === 'create' ? 'primary' : 'ghost'}
          onClick={() => setMode('create')}
        >
          New game
        </Button>
        <Button
          role="tab"
          aria-selected={mode === 'join'}
          variant={mode === 'join' ? 'primary' : 'ghost'}
          onClick={() => setMode('join')}
        >
          Join with a code
        </Button>
      </div>

      {mode === 'create' ? <CreateForm /> : <JoinForm />}
    </div>
  );
}

function Failure({ failure }: { readonly failure: ApiFailure | null }) {
  if (failure === null) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {failure.message}
    </p>
  );
}

function CreateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [startingCash, setStartingCash] = useState(1500);
  const [salary, setSalary] = useState(200);
  const [auctionSeconds, setAuctionSeconds] = useState(30);
  const [incomeTaxMode, setIncomeTaxMode] = useState<'flat' | 'percentage'>('flat');
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

    const result = await createGameRequest(trimmed, {
      startingCash,
      salary,
      freeParkingPot,
      incomeTaxMode,
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
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
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

      <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
        <legend className="text-xs uppercase tracking-[0.04em] text-text-faint">
          House rules — fixed once the game starts
        </legend>

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Starting cash"
            value={startingCash}
            onChange={(event) => setStartingCash(Number(event.target.value))}
          >
            <option value={1000}>£1,000</option>
            <option value={1500}>£1,500</option>
            <option value={2000}>£2,000</option>
          </SelectField>

          <SelectField
            label="Salary"
            value={salary}
            onChange={(event) => setSalary(Number(event.target.value))}
          >
            <option value={200}>£200</option>
            <option value={400}>£400</option>
          </SelectField>

          <SelectField
            label="Income tax"
            value={incomeTaxMode}
            onChange={(event) =>
              setIncomeTaxMode(event.target.value === 'percentage' ? 'percentage' : 'flat')
            }
          >
            <option value="flat">Flat £200</option>
            <option value="percentage">10% of worth</option>
          </SelectField>

          <SelectField
            label="Auction time"
            value={auctionSeconds}
            onChange={(event) => setAuctionSeconds(Number(event.target.value))}
          >
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option>
            <option value={120}>120 seconds</option>
          </SelectField>
        </div>

        <CheckField
          label="Free parking collects the pot"
          checked={freeParkingPot}
          onChange={(event) => setFreeParkingPot(event.target.checked)}
        />
        <CheckField
          label="Declining a property sends it to auction"
          checked={auctionOnDecline}
          onChange={(event) => setAuctionOnDecline(event.target.checked)}
        />
      </fieldset>

      <Failure failure={failure} />

      <Button type="submit" variant="primary" pending={pending} disabled={!canSubmit}>
        Create game
      </Button>
    </form>
  );
}

function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
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
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
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
        className="font-mono uppercase tracking-[0.04em]"
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

      <Button type="submit" variant="primary" pending={pending} disabled={!canSubmit}>
        Join game
      </Button>
    </form>
  );
}
