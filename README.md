# Parkway

A real-time multiplayer property-trading board game for the browser. Open a link, share a six-character room code, and play a full game with up to five friends. No accounts, no installs, no matchmaking queue.

**Status: in development.** The build ships in stages; see [Progress](#progress) for what currently works. Nothing here is deployed yet.

## Why this exists

Playing a property-trading board game with remote friends usually means either a physical board nobody is sitting at, or an online version buried in ads, sign-up walls and casino styling. Parkway is the version that just opens: one link, correct rules, everyone sees the same board.

## How it works

The interesting constraint is rule correctness. Property-trading games are deceptively hard to implement — the bugs live in the interactions, not the individual rules. Three doubles on a turn that would have landed you on go-to-jail. A card sending a player to a mortgaged railroad. A hotel purchase that frees the last four houses another player was waiting on. Cascading bankruptcy where the creditor is themselves in debt.

So the whole design is arranged around making those interactions exhaustively testable:

**One engine, and it is pure.** All rules live in `@parkway/engine`, a TypeScript package with zero runtime dependencies. It imports no framework, no Node built-in, and never calls `Date.now()` or `Math.random()`. It is a reducer — `(state, action) → { state, events }` or a rule violation — and nothing more. Time and randomness enter as data. That means a full game can be played in a test in milliseconds, with no database, no network and no browser.

**The server is the only authority.** Clients never compute outcomes, not even dice. Every action is a POST; the server loads state, runs the reducer, persists the result and broadcasts it. The client renders what it is told and derives every button from `getLegalActions`. There is deliberately no optimistic local application — running the rules in two places and reconciling the divergence buys about 150ms on a turn-based game and costs a whole category of desync bugs.

**Randomness is seeded and secret.** The RNG lives inside the game state as a seed advanced by a pure function. Replays are therefore exact: the initial state folded over the action log reproduces the current state byte for byte, which is asserted by a test. The seed never leaves the server — a client holding it could predict every future roll — so every outbound payload is projected through a single function that strips it.

**The board is data.** The engine hardcodes no square. It reads a board pack that declares squares, rent tables, groups, build costs, bank supply and both card decks as typed effects. This keeps rules testable on tiny synthetic boards — a twelve-square board with two groups is enough to exercise even-build in isolation — and makes an alternate board a config change rather than a refactor.

The shipped pack is set in a fictional city called Ashvale, with original square names and original card text. It is mechanically identical to the game you already know: same prices, same rent tables, same house costs, same bank supply.

## Stack

Next.js 15 (App Router, Node runtime) · React 19 · TypeScript 5.6 strict · Tailwind 4 · shadcn/ui · Zustand · Supabase Postgres and Realtime · Vitest · Playwright · pnpm workspaces.

```
packages/engine    the rules — zero dependencies, pure, framework-free
apps/web           Next.js app: routes, server layer, UI
```

The engine is the only place a rule may live. A React component that computes rent, decides whose turn it is, or enables a button from its own logic is a bug, not a shortcut.

## Running it locally

Requires Node 22 and pnpm 9.

```bash
pnpm install
pnpm dev
```

Multiplayer needs a Supabase project. Copy `.env.example` to `.env.local` and fill in your project URL, anon key and service-role key. The service-role key is server-only and must never be given a `NEXT_PUBLIC_` prefix.

```bash
pnpm db:migrate       # apply migrations
pnpm test             # all packages
pnpm test:engine      # engine only — the fast loop
pnpm typecheck
pnpm lint
```

## Progress

| Stage | What it covers | State |
|-------|----------------|-------|
| 1 | Workspace, tooling, design tokens | in progress |
| 2 | Engine foundations: state, board pack, seeded RNG, test harness | not started |
| 3 | Turn loop, headless | not started |
| 4 | Database, server routes, live multiplayer | not started |
| 5 | Board and shell UI | not started |
| 6 | Rules: buying, rent, cards, jail, auctions, building, mortgages, trading, bankruptcy | not started |
| 7 | Fuzz and replay hardening | not started |
| 8 | Design and accessibility pass | not started |
| 9 | Deployment | not started |

Each stage ends in something you can actually run, and is tagged with release notes describing what changed.

## Scope

**In:** the full standard rule set — purchases, auctions, rent with groups and railroads and utilities, taxes, jail, both card decks, houses and hotels with even-build and finite bank supply, mortgaging, player-to-player trading, debt settlement, bankruptcy to a player and to the bank, last player standing. Reconnect that restores your seat. A complete, replayable action log rendered as a readable feed. Configurable rule variants set at creation.

**Out:** accounts, matchmaking, public lobbies, bots, spectating, in-game chat, and phone-sized layouts. Below 768px the app asks for a larger screen rather than pretending a forty-square board fits on a phone.

## Licence

MIT. See [LICENSE](LICENSE).

Parkway is an original implementation. It is not affiliated with, endorsed by, or derived from any commercial board game publisher, and it ships no third-party names, artwork or card text.
