create table households (
  household_id text primary key,
  seeded_at timestamptz not null default now()
);

create table people (
  id text primary key,
  household_id text not null,
  slug text not null,
  display_name text not null,
  calorie_target integer not null,
  protein_target_g integer not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (household_id, slug),
  constraint people_name_chk check (char_length(display_name) between 1 and 40),
  constraint people_calories_chk check (calorie_target between 1 and 8000),
  constraint people_protein_chk check (protein_target_g between 0 and 400)
);

create table staples (
  id text primary key,
  household_id text not null,
  name text not null,
  kind text not null,
  meal text not null,
  calories integer not null,
  protein_g numeric(6,1) not null,
  source_note text not null default '',
  created_at timestamptz not null default now(),
  constraint staples_name_chk check (char_length(name) between 1 and 80),
  constraint staples_kind_chk check (kind in ('food', 'drink')),
  constraint staples_meal_chk check (meal in ('breakfast', 'lunch', 'dinner', 'snack', 'drink')),
  constraint staples_calories_chk check (calories between 0 and 8000),
  constraint staples_protein_chk check (protein_g between 0 and 500),
  constraint staples_note_chk check (char_length(source_note) <= 200)
);

create index staples_household_idx on staples (household_id, meal);

create table entries (
  id text primary key,
  household_id text not null,
  person_id text not null references people (id),
  eaten_on date not null,
  meal text not null,
  kind text not null,
  name text not null,
  calories integer not null,
  protein_g numeric(6,1) not null,
  servings numeric(4,2) not null default 1,
  created_at timestamptz not null default now(),
  constraint entries_name_chk check (char_length(name) between 1 and 80),
  constraint entries_kind_chk check (kind in ('food', 'drink')),
  constraint entries_meal_chk check (meal in ('breakfast', 'lunch', 'dinner', 'snack', 'drink')),
  constraint entries_calories_chk check (calories between 0 and 8000),
  constraint entries_protein_chk check (protein_g between 0 and 500),
  constraint entries_servings_chk check (servings between 0.25 and 10)
);

create index entries_day_idx on entries (household_id, eaten_on);
