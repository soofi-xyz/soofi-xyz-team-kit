create table daily_totals (
  id text primary key,
  household_id text not null,
  person_id text not null references people (id),
  consumed_on date not null,
  calories integer not null,
  protein_g numeric(6,1) not null,
  updated_at timestamptz not null default now(),
  unique (household_id, person_id, consumed_on),
  constraint daily_totals_calories_chk check (calories between 0 and 8000),
  constraint daily_totals_protein_chk check (protein_g between 0 and 500)
);

create index daily_totals_week_idx on daily_totals (household_id, consumed_on);
