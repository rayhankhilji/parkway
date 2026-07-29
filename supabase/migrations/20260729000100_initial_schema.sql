-- Parkway: initial schema.
--
-- The database is a durable box for the engine's state, not a model of the game.
-- Every rule fact lives inside games.state as one JSONB document written in one
-- statement, which gives atomicity for free and keeps exactly one implementation
-- of the rules (→ D6). Nothing here knows what a house or a rent is.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

create table games (
  id uuid primary key default gen_random_uuid(),

  -- The unambiguous alphabet: no O, 0, I or 1, so a code read aloud or copied
  -- off a screen cannot be mistyped into someone else's game.
  room_code text not null unique check (room_code ~ '^[A-HJ-NP-Z2-9]{6}$'),

  status text not null default 'lobby'
    check (status in ('lobby', 'active', 'finished', 'abandoned')),

  config jsonb not null,
  board_pack_id text not null default 'parkway-classic',

  -- The exact opening position, kept so the action log can be replayed against
  -- it. Without this the log proves nothing.
  initial_state jsonb,

  -- The current authoritative state, including the generator seed and both deck
  -- orders. Never returned to a client: every outbound payload is projected
  -- through the engine's toPublicState first.
  state jsonb,

  -- The optimistic concurrency token, incremented in the same statement that
  -- writes state. This is the entire concurrency control (→ D4).
  seq integer not null default 0,

  host_player_id uuid,
  winner_player_id uuid,

  last_action_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
--
-- Identity only. Who someone is, not how their game is going. A player's name
-- appears exactly once in the system, here — the engine never stores or emits
-- names, it emits structured events referencing ids.

create table players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games (id) on delete cascade,

  -- A seat is a UI slot assigned in join order. Turn order is a separate
  -- shuffled array inside games.state. Do not conflate them.
  seat smallint not null check (seat between 0 and 5),

  name text not null check (char_length(name) between 1 and 20),
  name_key text not null,

  colour text not null
    check (colour in ('rose', 'amber', 'emerald', 'sky', 'violet', 'slate')),

  -- SHA-256 of the player's bearer token. The plaintext is returned once at
  -- join and never stored, so a database leak cannot be used to play as anyone.
  token_hash text not null,

  is_connected boolean not null default false,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (game_id, seat),
  unique (game_id, name_key),
  unique (game_id, colour)
);

-- games references players and players references games, so the game row is
-- inserted first and these are added afterwards. A circular NOT NULL would be
-- unsatisfiable.
alter table games
  add constraint games_host_player_id_fkey
  foreign key (host_player_id) references players (id) on delete set null;

alter table games
  add constraint games_winner_player_id_fkey
  foreign key (winner_player_id) references players (id) on delete set null;

-- ---------------------------------------------------------------------------
-- game_actions
-- ---------------------------------------------------------------------------
--
-- Append-only. Never updated, never deleted except by cascade.
--
-- initial_state folded over every action in seq order must reproduce state
-- exactly. A test asserts it. If it ever fails, the engine has non-determinism
-- in it, and that is the highest-severity bug this project can have.

create table game_actions (
  id bigserial primary key,
  game_id uuid not null references games (id) on delete cascade,

  seq integer not null,

  -- Null for system-originated actions such as auction timeouts, which any
  -- client may fire and which belong to no player.
  player_id uuid references players (id) on delete set null,

  action jsonb not null,

  -- Stored rather than recomputed, so the feed renders after a reconnect
  -- without re-running the engine in the browser.
  events jsonb not null,

  created_at timestamptz not null default now(),

  unique (game_id, seq)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
--
-- Only what has a query behind it. room_code and (game_id, seq) are already
-- covered by their unique constraints.

create index games_last_action_at_idx on games (last_action_at);
create index players_game_id_idx on players (game_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger games_set_updated_at
  before update on games
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Enabled with zero policies, deliberately. Browsers hold only the anon key and
-- can therefore read and write nothing directly — the Supabase client in browser
-- code exists solely to subscribe to a Realtime broadcast channel.
--
-- All access goes through the server routes using the service-role key, which
-- bypasses RLS. Adding a policy here to make something work in the browser is
-- not a fix; it is the beginning of a second, weaker authorisation system.

alter table games enable row level security;
alter table players enable row level security;
alter table game_actions enable row level security;
