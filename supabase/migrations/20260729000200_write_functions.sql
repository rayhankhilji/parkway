-- Writes that have to be atomic.
--
-- PostgREST gives one statement per request, so anything that must not be seen
-- half-done needs a function. These three are pure persistence mechanics: they
-- move bytes, allocate a seat, and guard a counter. None of them knows what a
-- rent or a house is, and none of them may ever learn — rules live in the engine
-- and nowhere else (→ D2, D18).
--
-- All three are revoked from anon and authenticated. Only the service role,
-- which the browser never holds, can call them.

-- ---------------------------------------------------------------------------
-- create_game_with_host
-- ---------------------------------------------------------------------------
--
-- The game row and its host player reference each other, so creating them takes
-- three statements. Run separately, a failure between them leaves a game nobody
-- is in and a room code permanently burnt.

create function create_game_with_host(
  p_room_code text,
  p_config jsonb,
  p_board_pack_id text,
  p_name text,
  p_name_key text,
  p_colour text,
  p_token_hash text
) returns table (game_id uuid, player_id uuid)
language plpgsql
as $$
declare
  v_game_id uuid;
  v_player_id uuid;
begin
  insert into games (room_code, config, board_pack_id)
  values (p_room_code, p_config, p_board_pack_id)
  returning id into v_game_id;

  insert into players (game_id, seat, name, name_key, colour, token_hash)
  values (v_game_id, 0, p_name, p_name_key, p_colour, p_token_hash)
  returning id into v_player_id;

  update games set host_player_id = v_player_id where id = v_game_id;

  return query select v_game_id, v_player_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- join_game
-- ---------------------------------------------------------------------------
--
-- Takes the row lock before reading the roster, so two people claiming the last
-- seat at the same moment are serialised rather than both being told there is
-- room. The unique constraints would catch that anyway, but they would report it
-- as a duplicate seat, which is not a sentence anybody can act on.
--
-- Returns a result code rather than raising, because "the game is full" is an
-- ordinary answer to a reasonable question, not an exception.

create function join_game(
  p_room_code text,
  p_name text,
  p_name_key text,
  p_token_hash text,
  p_max_seats integer
) returns table (result text, out_game_id uuid, out_player_id uuid)
language plpgsql
as $$
declare
  v_game games%rowtype;
  v_seat smallint;
  v_colour text;
  v_player_id uuid;
  v_colours text[] := array['rose', 'amber', 'emerald', 'sky', 'violet', 'slate'];
begin
  select * into v_game from games where room_code = p_room_code for update;

  if not found then
    return query select 'GAME_NOT_FOUND'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_game.status in ('finished', 'abandoned') then
    return query select 'GAME_FINISHED'::text, v_game.id, null::uuid;
    return;
  end if;

  if v_game.status <> 'lobby' then
    return query select 'GAME_ALREADY_STARTED'::text, v_game.id, null::uuid;
    return;
  end if;

  if exists (select 1 from players where game_id = v_game.id and name_key = p_name_key) then
    return query select 'NAME_TAKEN'::text, v_game.id, null::uuid;
    return;
  end if;

  -- Lowest free seat, so seats stay packed as people come and go.
  select min(seat) into v_seat
  from generate_series(0, p_max_seats - 1) as seat
  where seat not in (select p.seat from players p where p.game_id = v_game.id);

  if v_seat is null then
    return query select 'GAME_FULL'::text, v_game.id, null::uuid;
    return;
  end if;

  v_colour := v_colours[v_seat + 1];

  insert into players (game_id, seat, name, name_key, colour, token_hash)
  values (v_game.id, v_seat, p_name, p_name_key, v_colour, p_token_hash)
  returning id into v_player_id;

  return query select 'JOINED'::text, v_game.id, v_player_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_action
-- ---------------------------------------------------------------------------
--
-- The guarded write. `where seq = p_expected_seq` is the whole of the
-- concurrency control: two simultaneous actions cannot both commit, and the
-- loser is told so rather than being retried against a state it never saw
-- (→ D4).
--
-- Returns null when it lost the race. The caller answers 409 and the client
-- refetches; it must not resend the action.

create function apply_action(
  p_game_id uuid,
  p_expected_seq integer,
  p_state jsonb,
  p_action jsonb,
  p_events jsonb,
  p_player_id uuid,
  p_status text,
  p_winner_player_id uuid
) returns integer
language plpgsql
as $$
declare
  v_new_seq integer;
begin
  update games
     set state = p_state,
         seq = games.seq + 1,
         status = p_status,
         winner_player_id = coalesce(p_winner_player_id, games.winner_player_id),
         finished_at = case
           when p_status = 'finished' and games.finished_at is null then now()
           else games.finished_at
         end,
         last_action_at = now()
   where games.id = p_game_id
     and games.seq = p_expected_seq
  returning games.seq into v_new_seq;

  if v_new_seq is null then
    return null;
  end if;

  insert into game_actions (game_id, seq, player_id, action, events)
  values (p_game_id, v_new_seq, p_player_id, p_action, p_events);

  return v_new_seq;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_game
-- ---------------------------------------------------------------------------
--
-- Writes the opening position. initial_state and state are set to the same
-- document, and both are needed: state moves as the game is played, while
-- initial_state stays put so the action log has something to replay against.

create function start_game(
  p_game_id uuid,
  p_state jsonb,
  p_action jsonb,
  p_events jsonb,
  p_player_id uuid
) returns integer
language plpgsql
as $$
declare
  v_new_seq integer;
begin
  update games
     set state = p_state,
         initial_state = p_state,
         status = 'active',
         seq = games.seq + 1,
         last_action_at = now()
   where games.id = p_game_id
     and games.status = 'lobby'
     and games.seq = 0
  returning games.seq into v_new_seq;

  if v_new_seq is null then
    return null;
  end if;

  insert into game_actions (game_id, seq, player_id, action, events)
  values (p_game_id, v_new_seq, p_player_id, p_action, p_events);

  return v_new_seq;
end;
$$;

revoke execute on function create_game_with_host from anon, authenticated;
revoke execute on function join_game from anon, authenticated;
revoke execute on function apply_action from anon, authenticated;
revoke execute on function start_game from anon, authenticated;
