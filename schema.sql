-- Run this in your Supabase SQL editor to set up the database

-- Game config table (holes, players, rules stored as JSON for simplicity)
create table if not exists pub_golf_game (
  id text primary key default 'main',
  holes jsonb not null default '[]',
  players jsonb not null default '[]',
  rules jsonb not null default '[]',
  updated_at timestamptz default now()
);

-- Scores table (one row per player per hole)
create table if not exists pub_golf_scores (
  id text primary key,  -- "{playerId}-{holeIdx}"
  player_id text not null,
  hole_index integer not null,
  sips integer not null default 0,
  penalties jsonb not null default '[]',
  updated_at timestamptz default now()
);

-- Enable realtime on both tables
alter publication supabase_realtime add table pub_golf_game;
alter publication supabase_realtime add table pub_golf_scores;

-- Insert default game config
insert into pub_golf_game (id, holes, players, rules)
values (
  'main',
  '[
    {"id":1,"bar":"Bar 1","drink":""},
    {"id":2,"bar":"Bar 2","drink":""},
    {"id":3,"bar":"Bar 3","drink":""},
    {"id":4,"bar":"Bar 4","drink":""},
    {"id":5,"bar":"Bar 5","drink":""},
    {"id":6,"bar":"Bar 6","drink":""},
    {"id":7,"bar":"Bar 7","drink":""},
    {"id":8,"bar":"Bar 8","drink":""},
    {"id":9,"bar":"Bar 9","drink":""}
  ]',
  '[
    {"id":1,"name":"Player 1","emoji":"🏌️"},
    {"id":2,"name":"Player 2","emoji":"🍺"}
  ]',
  '[
    {"id":1,"text":"Using two hands to drink","penalty":1},
    {"id":2,"text":"Spilling your drink","penalty":2},
    {"id":3,"text":"Leaving the course early","penalty":5}
  ]'
)
on conflict (id) do nothing;
