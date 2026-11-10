"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MEAL_LABEL,
  MEALS,
  TRACKER_NOTE,
  dayAsText,
  dayNumber,
  dailyRead,
  formatKcal,
  formatLongDate,
  formatProtein,
  formatServings,
  isKind,
  isMeal,
  isRecord,
  lineTotals,
  mealForHour,
  parseAdd,
  parseDate,
  parsePerson,
  parseStaple,
  shiftDate,
  sumEntries,
  weekdayShort,
  type Board,
  type Entry,
  type Kind,
  type Meal,
  type Person,
  type Staple,
} from "../lib/food";

type View = "aleyna" | "soofi" | "both";
type Result = { ok: true } | { ok: false; error: string };

function todayIso(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isBoard(value: unknown): value is Board {
  return isRecord(value) && typeof value.date === "string" && Array.isArray(value.people) && Array.isArray(value.staples) && Array.isArray(value.entries);
}

async function send(url: string, method: string, body?: unknown): Promise<Result> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = isRecord(payload) && typeof payload.error === "string" ? payload.error : "Could not save that.";
      return { ok: false, error };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the tracker." };
  }
}

export function Plate() {
  const [date, setDate] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [meal, setMeal] = useState<Meal>("breakfast");
  const [view, setView] = useState<View>("aleyna");
  const [logSlug, setLogSlug] = useState<"aleyna" | "soofi">("aleyna");
  const [board, setBoard] = useState<Board | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [bad, setBad] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [undo, setUndo] = useState<Entry | null>(null);
  const [kind, setKind] = useState<Kind>("food");
  const [itemName, setItemName] = useState("");
  const [itemCalories, setItemCalories] = useState("");
  const [itemProtein, setItemProtein] = useState("");
  const [itemServings, setItemServings] = useState("1");
  const [saveStaple, setSaveStaple] = useState(false);
  const [copied, setCopied] = useState("");
  const lock = useRef(false);

  useEffect(() => {
    const now = new Date();
    const iso = todayIso(now);
    setToday(iso);
    setDate(iso);
    const nextMeal = mealForHour(now.getHours());
    setMeal(nextMeal);
    setKind(nextMeal === "drink" ? "drink" : "food");
    const saved = window.localStorage.getItem("daily-plate-person");
    if (saved === "soofi" || saved === "both" || saved === "aleyna") setView(saved);
    if (saved === "soofi") setLogSlug("soofi");
  }, []);

  useEffect(() => {
    if (!date) return;
    let ignore = false;
    (async () => {
      try {
        const response = await fetch(`/api/board?date=${encodeURIComponent(date)}`);
        const payload: unknown = await response.json().catch(() => null);
        if (ignore) return;
        if (!response.ok || !isBoard(payload)) {
          const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : "Could not load this day.";
          setLoadError(message);
          return;
        }
        setBoard(payload);
        setLoadError("");
      } catch {
        if (!ignore) setLoadError("Could not reach the tracker.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, [date, refresh]);

  function tell(message: string, isBad = false) {
    setNotice(message);
    setBad(isBad);
  }

  function chooseView(next: View) {
    setView(next);
    if (next !== "both") setLogSlug(next);
    window.localStorage.setItem("daily-plate-person", next);
    tell("");
  }

  function chooseMeal(next: Meal) {
    setMeal(next);
    setKind(next === "drink" ? "drink" : "food");
  }

  async function run(task: () => Promise<Result>, ok: string): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      const result = await task();
      if (!result.ok) {
        tell(result.error, true);
        return false;
      }
      tell(ok);
      setRefresh((value) => value + 1);
      return true;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (!date || !today) {
    return (
      <main className="page">
        <header className="top">
          <div>
            <p className="eyebrow">Nutrition tracker</p>
            <h1>Daily plate</h1>
          </div>
        </header>
        <p className="status">Loading today's plate.</p>
      </main>
    );
  }

  const people = board?.people ?? [];
  const aleyna = people.find((person) => person.slug === "aleyna");
  const soofi = people.find((person) => person.slug === "soofi");
  const active = people.find((person) => person.slug === (view === "both" ? logSlug : view)) ?? people[0];
  const shown = view === "both" ? people : people.filter((person) => person.slug === view);
  const dayEntries = (personId: string) => board?.entries.filter((entry) => entry.personId === personId && entry.date === date) ?? [];
  const yesterday = shiftDate(date, -1);
  const yesterdayCount = active ? board?.entries.filter((entry) => entry.personId === active.id && entry.date === yesterday).length ?? 0 : 0;
  const visibleStaples = (board?.staples ?? [])
    .filter((staple) => showAll || staple.meal === meal)
    .slice()
    .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.name.localeCompare(b.name));

  async function logStaple(staple: Staple) {
    if (!active) return;
    await run(
      () =>
        send("/api/entries", "POST", {
          personId: active.id,
          date,
          meal,
          kind: staple.kind,
          name: staple.name,
          calories: staple.calories,
          protein: staple.protein,
          servings: 1,
        }),
      `Added ${staple.name} to ${MEAL_LABEL[meal]} for ${active.name}.`,
    );
  }

  async function addCustom(event: FormEvent) {
    event.preventDefault();
    if (!active) return;
    const parsed = parseAdd({
      personId: active.id,
      date,
      meal,
      kind,
      name: itemName,
      calories: itemCalories,
      protein: itemProtein,
      servings: itemServings,
      saveStaple,
    });
    if (!parsed.ok) {
      tell(parsed.error, true);
      return;
    }
    const saved = await run(() => send("/api/entries", "POST", parsed.value), `Added ${parsed.value.name} for ${active.name}.`);
    if (saved) {
      setItemName("");
      setItemCalories("");
      setItemProtein("");
      setItemServings("1");
      setSaveStaple(false);
    }
  }

  async function copyYesterday() {
    if (!active) return;
    await run(
      () => send("/api/entries", "POST", { op: "copy", personId: active.id, from: yesterday, to: date }),
      `Copied ${yesterdayCount} item${yesterdayCount === 1 ? "" : "s"} from yesterday onto ${active.name}'s day.`,
    );
  }

  async function copyText() {
    if (!active || !date) return;
    const totals = sumEntries(dayEntries(active.id));
    const text = dayAsText({
      name: active.name,
      dateLabel: formatLongDate(date),
      calories: totals.calories,
      calorieTarget: active.calorieTarget,
      protein: totals.protein,
      proteinTarget: active.proteinTarget,
      groups: MEALS.map((slot) => ({
        meal: slot,
        lines: dayEntries(active.id)
          .filter((entry) => entry.meal === slot)
          .map((entry) => ({ name: entry.name, servings: entry.servings, ...lineTotals(entry.calories, entry.protein, entry.servings) })),
      })),
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied("");
      tell("Copied this day as text.");
    } catch {
      setCopied(text);
      tell("Clipboard is blocked here. The day is in the box below.", true);
    }
  }

  async function patchEntry(entry: Entry, patch: Record<string, unknown>, ok: string) {
    return run(() => send("/api/entries", "PATCH", { id: entry.id, ...patch }), ok);
  }

  async function removeEntry(entry: Entry) {
    const saved = await run(() => send(`/api/entries?id=${encodeURIComponent(entry.id)}`, "DELETE"), `Removed ${entry.name}.`);
    if (saved) setUndo(entry);
    return saved;
  }

  async function restore(entry: Entry) {
    const saved = await run(
      () =>
        send("/api/entries", "POST", {
          personId: entry.personId,
          date: entry.date,
          meal: entry.meal,
          kind: entry.kind,
          name: entry.name,
          calories: entry.calories,
          protein: entry.protein,
          servings: entry.servings,
        }),
      `Put ${entry.name} back.`,
    );
    if (saved) setUndo(null);
  }

  const days = Array.from({ length: 7 }, (_, index) => shiftDate(date, index - 6));

  return (
    <main className="page">
      <header className="top">
        <div>
          <p className="eyebrow">Nutrition tracker</p>
          <h1>Daily plate</h1>
          <p className="deck">Log food and drinks for Aleyna and Soofi. Tap a staple to add calories and protein without typing them again.</p>
        </div>
        {aleyna && soofi ? (
          <div className="switch" role="radiogroup" aria-label="Whose day to show">
            <button type="button" role="radio" aria-checked={view === "aleyna"} onClick={() => chooseView("aleyna")}>{aleyna.name}</button>
            <button type="button" role="radio" aria-checked={view === "soofi"} onClick={() => chooseView("soofi")}>{soofi.name}</button>
            <button type="button" role="radio" aria-checked={view === "both"} onClick={() => chooseView("both")}>Both</button>
          </div>
        ) : null}
      </header>

      {loadError && !board ? (
        <p className="alert" role="alert">
          {loadError}{" "}
          <button type="button" className="text-button" onClick={() => setRefresh((value) => value + 1)}>Try again</button>
        </p>
      ) : null}

      {board && active ? (
        <div className="layout">
          <section className="summary" aria-label="Daily totals">
            <div className="date-row">
              <button type="button" className="ghost" onClick={() => { setDate(shiftDate(date, -1)); setUndo(null); tell(""); }} disabled={date <= "2020-01-01"}>Previous</button>
              <input
                type="date"
                aria-label="Day"
                value={date}
                min="2020-01-01"
                max="2100-12-31"
                onChange={(event) => {
                  const next = parseDate(event.target.value);
                  if (next) {
                    setDate(next);
                    setUndo(null);
                    tell("");
                  }
                }}
              />
              <button type="button" className="ghost" onClick={() => { setDate(shiftDate(date, 1)); setUndo(null); tell(""); }} disabled={shiftDate(date, 1) > shiftDate(today, 14)}>Next</button>
              {date !== today ? <button type="button" className="ghost" onClick={() => { setDate(today); setUndo(null); tell(""); }}>Today</button> : null}
            </div>
            <p className="quiet">{formatLongDate(date)}{date === today ? " · today" : ""}</p>

            {shown.map((person) => {
              const totals = sumEntries(dayEntries(person.id));
              const read = dailyRead({
                name: person.name,
                calories: totals.calories,
                calorieTarget: person.calorieTarget,
                protein: totals.protein,
                proteinTarget: person.proteinTarget,
                staples: board.staples,
                loggedCount: dayEntries(person.id).length,
              });
              return (
                <div className="read" key={person.id}>
                  {view === "both" ? <h2>{person.name}</h2> : null}
                  <div className="stats">
                    <Remainder tone="cal" label="Calories" unit="kcal" logged={totals.calories} target={person.calorieTarget} format={formatKcal} />
                    <Remainder tone="pro" label="Protein" unit="g" logged={totals.protein} target={person.proteinTarget} format={(value) => `${formatProtein(value)} g`} />
                  </div>
                  <h2>Dietician note</h2>
                  <p>{read.headline}</p>
                  <p className="quiet">{read.detail}</p>
                </div>
              );
            })}

            <p className="legend"><span><i className="swatch cal" />Calories</span><span><i className="swatch pro" />Protein</span></p>
            {view === "both" ? (
              <WeekTable days={days} people={people} entries={board.entries} selected={date} onPick={(next) => { setDate(next); setUndo(null); tell(""); }} />
            ) : (
              <WeekBars days={days} person={active} entries={board.entries} selected={date} onPick={(next) => { setDate(next); setUndo(null); tell(""); }} />
            )}
            <p className="micro">
              {view === "both"
                ? "Seven days ending on the selected day. Each cell is calories, then protein grams."
                : "Seven days ending on the selected day. Bars show each total as a share of that person's target."}
            </p>

            <Targets
              people={people}
              busy={busy}
              onSave={async (person, draft) => {
                const parsed = parsePerson({ id: person.id, ...draft });
                if (!parsed.ok) {
                  tell(parsed.error, true);
                  return false;
                }
                return run(() => send("/api/people", "PATCH", parsed.value), `Saved targets for ${parsed.value.name}.`);
              }}
            />
          </section>

          <section className="sheet" aria-label={`Log for ${active.name}`}>
            <h2>{active.name} · {formatLongDate(date)}</h2>
            {view === "both" && aleyna && soofi ? (
              <div className="switch who" role="radiogroup" aria-label="Who to add items for">
                <button type="button" role="radio" aria-checked={logSlug === "aleyna"} onClick={() => setLogSlug("aleyna")}>{aleyna.name}</button>
                <button type="button" role="radio" aria-checked={logSlug === "soofi"} onClick={() => setLogSlug("soofi")}>{soofi.name}</button>
              </div>
            ) : null}
            <div className="date-row">
              <button type="button" className="ghost" disabled={busy || yesterdayCount === 0} onClick={() => void copyYesterday()}>
                Copy yesterday{yesterdayCount > 0 ? ` (${yesterdayCount})` : ""}
              </button>
              <button type="button" className="ghost" onClick={() => void copyText()}>Copy day as text</button>
            </div>
            {notice ? <p className={bad ? "alert" : "status"} role={bad ? "alert" : "status"}>{notice}</p> : null}
            {undo && undo.date === date && undo.personId === active.id ? (
              <button type="button" className="text-button" disabled={busy} onClick={() => void restore(undo)}>Undo remove</button>
            ) : null}
            {loadError ? <p className="alert" role="alert">{loadError}</p> : null}

            <div className="meals" role="radiogroup" aria-label="Meal">
              {MEALS.map((slot) => (
                <button key={slot} type="button" role="radio" aria-checked={meal === slot} onClick={() => chooseMeal(slot)}>
                  {MEAL_LABEL[slot]}
                </button>
              ))}
            </div>
            <p className="quiet">Adds to {MEAL_LABEL[meal]} for {active.name}. Staple numbers are for one serving.</p>
            <button type="button" className="text-button" aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Showing every staple" : `Show all staples (${board.staples.length})`}
            </button>
            {visibleStaples.length === 0 ? <p className="quiet">No staples for {MEAL_LABEL[meal].toLowerCase()} yet. Show all, or save a new one below.</p> : null}
            <div className="staples">
              {visibleStaples.map((staple) => (
                <button key={staple.id} type="button" className="staple" disabled={busy} title={staple.sourceNote} onClick={() => void logStaple(staple)}>
                  <b>{staple.name}</b>
                  <span>{staple.calories.toLocaleString("en-US")} kcal · {formatProtein(staple.protein)} g</span>
                </button>
              ))}
            </div>

            <form className="add-form" onSubmit={(event) => void addCustom(event)}>
              <label className="field name">Name
                <input value={itemName} onChange={(event) => setItemName(event.target.value)} maxLength={80} autoComplete="off" />
              </label>
              <label className="field">Calories
                <input inputMode="decimal" value={itemCalories} onChange={(event) => setItemCalories(event.target.value)} />
              </label>
              <label className="field">Protein g
                <input inputMode="decimal" value={itemProtein} onChange={(event) => setItemProtein(event.target.value)} />
              </label>
              <label className="field">Servings
                <input inputMode="decimal" value={itemServings} onChange={(event) => setItemServings(event.target.value)} />
              </label>
              <label className="field">Food or drink
                <select value={kind} onChange={(event) => { if (isKind(event.target.value)) setKind(event.target.value); }}>
                  <option value="food">Food</option>
                  <option value="drink">Drink</option>
                </select>
              </label>
              <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Add"}</button>
              <label className="check name">
                <input type="checkbox" checked={saveStaple} onChange={(event) => setSaveStaple(event.target.checked)} />
                Save this as a staple for {MEAL_LABEL[meal].toLowerCase()}
              </label>
            </form>

            {MEALS.map((slot) => {
              const rows = dayEntries(active.id).filter((entry) => entry.meal === slot);
              return (
                <div className="meal-block" key={slot}>
                  <h3>{MEAL_LABEL[slot]}</h3>
                  {rows.length === 0 ? <p className="quiet">Nothing logged.</p> : null}
                  {rows.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      people={people}
                      busy={busy}
                      onPatch={(patch, ok) => patchEntry(entry, patch, ok)}
                      onDelete={() => removeEntry(entry)}
                      onSaveStaple={() =>
                        run(
                          () =>
                            send("/api/staples", "POST", {
                              name: entry.name,
                              meal: entry.meal,
                              kind: entry.kind,
                              calories: entry.calories,
                              protein: entry.protein,
                            }),
                          `Saved ${entry.name} as a staple.`,
                        )
                      }
                    />
                  ))}
                </div>
              );
            })}

            <StapleEditor
              staples={board.staples}
              busy={busy}
              onSave={async (id, input) => {
                const parsed = parseStaple(input);
                if (!parsed.ok) {
                  tell(parsed.error, true);
                  return false;
                }
                if (id) return run(() => send("/api/staples", "PATCH", { id, ...parsed.value }), `Updated ${parsed.value.name}.`);
                return run(() => send("/api/staples", "POST", parsed.value), `Saved ${parsed.value.name} as a staple.`);
              }}
              onDelete={async (staple) => run(() => send(`/api/staples?id=${encodeURIComponent(staple.id)}`, "DELETE"), `Removed the ${staple.name} staple.`)}
            />
            {copied ? <textarea readOnly value={copied} aria-label="Day as text" /> : null}
          </section>
        </div>
      ) : board ? (
        <p className="alert" role="alert">This log has no people yet.</p>
      ) : loadError ? null : (
        <p className="status">Loading today's plate.</p>
      )}

      <p className="footer">{TRACKER_NOTE}</p>
    </main>
  );
}

function Remainder({
  tone,
  label,
  unit,
  logged,
  target,
  format,
}: {
  tone: "cal" | "pro";
  label: string;
  unit: string;
  logged: number;
  target: number;
  format: (value: number) => string;
}) {
  const left = Math.round((target - logged) * 10) / 10;
  const over = left < 0;
  const shown = over ? -left : left;
  const pct = target === 0 ? 0 : Math.min(100, (logged / target) * 100);
  return (
    <div className={`stat ${tone}`}>
      <span className="label">{over ? `${label} over` : `${label} left`}</span>
      <b>{tone === "cal" ? Math.round(shown).toLocaleString("en-US") : formatProtein(shown)}<small>{unit}</small></b>
      <span className="sub">{format(logged)} of {format(target)} logged</span>
      <div className="meter" aria-hidden="true"><i style={{ ["--pct" as string]: pct, ["--tone" as string]: tone === "cal" ? "var(--cal)" : "var(--pro)" }} /></div>
    </div>
  );
}

function WeekBars({
  days,
  person,
  entries,
  selected,
  onPick,
}: {
  days: string[];
  person: Person;
  entries: Entry[];
  selected: string;
  onPick: (date: string) => void;
}) {
  return (
    <div className="week" role="list">
      {days.map((iso) => {
        const totals = sumEntries(entries.filter((entry) => entry.personId === person.id && entry.date === iso));
        const calPct = person.calorieTarget === 0 ? 0 : Math.min(100, (totals.calories / person.calorieTarget) * 100);
        const proPct = person.proteinTarget === 0 ? 0 : Math.min(100, (totals.protein / person.proteinTarget) * 100);
        return (
          <button
            key={iso}
            type="button"
            aria-current={iso === selected ? "date" : undefined}
            aria-label={`${weekdayShort(iso)} ${iso}, ${formatKcal(totals.calories)}, ${formatProtein(totals.protein)} g protein`}
            onClick={() => onPick(iso)}
          >
            <span>{weekdayShort(iso)}</span>
            <span className="bars" aria-hidden="true">
              <i className="cal" style={{ ["--pct" as string]: calPct }} />
              <i className="pro" style={{ ["--pct" as string]: proPct }} />
            </span>
            <span className="mini">{totals.calories}</span>
          </button>
        );
      })}
    </div>
  );
}

function WeekTable({
  days,
  people,
  entries,
  selected,
  onPick,
}: {
  days: string[];
  people: Person[];
  entries: Entry[];
  selected: string;
  onPick: (date: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="week-table">
        <caption>Calories and protein for both people over seven days. The highlighted day is the one open now.</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            {days.map((iso) => (
              <th key={iso} scope="col">
                <button type="button" className="day-link" aria-current={iso === selected ? "date" : undefined} onClick={() => onPick(iso)}>
                  {weekdayShort(iso)} {dayNumber(iso)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id}>
              <th scope="row">{person.name}</th>
              {days.map((iso) => {
                const totals = sumEntries(entries.filter((entry) => entry.personId === person.id && entry.date === iso));
                return <td key={iso}>{totals.calories}<br />{formatProtein(totals.protein)} g</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntryRow({
  entry,
  people,
  busy,
  onPatch,
  onDelete,
  onSaveStaple,
}: {
  entry: Entry;
  people: Person[];
  busy: boolean;
  onPatch: (patch: Record<string, unknown>, ok: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onSaveStaple: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(entry.name);
  const [calories, setCalories] = useState(String(entry.calories));
  const [protein, setProtein] = useState(String(entry.protein));
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [kind, setKind] = useState<Kind>(entry.kind);
  const [personId, setPersonId] = useState(entry.personId);
  const line = lineTotals(entry.calories, entry.protein, entry.servings);

  useEffect(() => {
    setName(entry.name);
    setCalories(String(entry.calories));
    setProtein(String(entry.protein));
    setMeal(entry.meal);
    setKind(entry.kind);
    setPersonId(entry.personId);
  }, [entry.id, entry.name, entry.calories, entry.protein, entry.meal, entry.kind, entry.personId]);

  function changeServings(delta: number) {
    const next = Math.min(10, Math.max(0.25, Math.round((entry.servings + delta) * 100) / 100));
    if (next === entry.servings) return;
    void onPatch({ servings: next }, `Updated servings for ${entry.name}.`);
  }

  return (
    <article className="entry">
      <div>
        <strong>{entry.name}</strong>
        <div className="entry-actions">
          <button type="button" className="step" aria-label={`Decrease servings of ${entry.name}`} disabled={busy || entry.servings <= 0.25} onClick={() => changeServings(-0.5)}>−</button>
          <span className="servings">{formatServings(entry.servings)}</span>
          <button type="button" className="step" aria-label={`Increase servings of ${entry.name}`} disabled={busy || entry.servings >= 10} onClick={() => changeServings(0.5)}>+</button>
          <button type="button" className="text-button" onClick={() => setOpen((value) => !value)}>{open ? "Close" : "Edit"}</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => void onSaveStaple()}>Save staple</button>
          <button type="button" className="text-button danger" disabled={busy} onClick={() => void onDelete()}>Remove</button>
        </div>
        {open ? (
          <form
            className="edit-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void onPatch({ name, calories, protein, meal, kind, personId }, `Updated ${name}.`);
            }}
          >
            <label className="field name">Name
              <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">Calories
              <input inputMode="decimal" value={calories} onChange={(event) => setCalories(event.target.value)} />
            </label>
            <label className="field">Protein g
              <input inputMode="decimal" value={protein} onChange={(event) => setProtein(event.target.value)} />
            </label>
            <label className="field">Meal
              <select value={meal} onChange={(event) => { if (isMeal(event.target.value)) setMeal(event.target.value); }}>
                {MEALS.map((slot) => <option key={slot} value={slot}>{MEAL_LABEL[slot]}</option>)}
              </select>
            </label>
            <label className="field">Kind
              <select value={kind} onChange={(event) => { if (isKind(event.target.value)) setKind(event.target.value); }}>
                <option value="food">Food</option>
                <option value="drink">Drink</option>
              </select>
            </label>
            <label className="field">Person
              <select value={personId} onChange={(event) => setPersonId(event.target.value)}>
                {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <button className="primary" type="submit" disabled={busy}>Save item</button>
          </form>
        ) : null}
      </div>
      <div className="macros">
        <span>{line.calories.toLocaleString("en-US")} kcal</span>
        <span className="pro">{formatProtein(line.protein)} g</span>
      </div>
    </article>
  );
}

function Targets({
  people,
  busy,
  onSave,
}: {
  people: Person[];
  busy: boolean;
  onSave: (person: Person, draft: { name: string; calorieTarget: string; proteinTarget: string }) => Promise<boolean>;
}) {
  return (
    <details>
      <summary>Daily targets</summary>
      <p className="quiet">Calories are daily maximums. Protein is a daily minimum.</p>
      {people.map((person) => (
        <TargetRow key={person.id} person={person} busy={busy} onSave={onSave} />
      ))}
    </details>
  );
}

function TargetRow({
  person,
  busy,
  onSave,
}: {
  person: Person;
  busy: boolean;
  onSave: (person: Person, draft: { name: string; calorieTarget: string; proteinTarget: string }) => Promise<boolean>;
}) {
  const [name, setName] = useState(person.name);
  const [calorieTarget, setCalorieTarget] = useState(String(person.calorieTarget));
  const [proteinTarget, setProteinTarget] = useState(String(person.proteinTarget));
  return (
    <form
      className="target-row"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(person, { name, calorieTarget, proteinTarget });
      }}
    >
      <label className="field name">Name
        <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">Calorie maximum
        <input inputMode="numeric" value={calorieTarget} onChange={(event) => setCalorieTarget(event.target.value)} />
      </label>
      <label className="field">Protein minimum g
        <input inputMode="decimal" value={proteinTarget} onChange={(event) => setProteinTarget(event.target.value)} />
      </label>
      <button className="primary" type="submit" disabled={busy}>Save</button>
    </form>
  );
}

function StapleEditor({
  staples,
  busy,
  onSave,
  onDelete,
}: {
  staples: Staple[];
  busy: boolean;
  onSave: (id: string | null, input: { name: string; meal: string; kind: string; calories: string; protein: string }) => Promise<boolean>;
  onDelete: (staple: Staple) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState("new");
  const current = staples.find((staple) => staple.id === selected) ?? null;
  const [name, setName] = useState("");
  const [meal, setMeal] = useState<Meal>("breakfast");
  const [kind, setKind] = useState<Kind>("food");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");

  useEffect(() => {
    if (!current) {
      setName("");
      setCalories("");
      setProtein("");
      return;
    }
    setName(current.name);
    setMeal(current.meal);
    setKind(current.kind);
    setCalories(String(current.calories));
    setProtein(String(current.protein));
  }, [current]);

  return (
    <details>
      <summary>Edit staples</summary>
      <label className="field" style={{ marginTop: 10 }}>
        Staple
        <select
          value={current ? current.id : "new"}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="new">New staple</option>
          {staples.map((staple) => (
            <option key={staple.id} value={staple.id}>{staple.name}</option>
          ))}
        </select>
      </label>
      <form
        className="staple-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(current?.id ?? null, { name, meal, kind, calories, protein });
        }}
      >
        <label className="field name">Name
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">Meal
          <select value={meal} onChange={(event) => { if (isMeal(event.target.value)) setMeal(event.target.value); }}>
            {MEALS.map((slot) => <option key={slot} value={slot}>{MEAL_LABEL[slot]}</option>)}
          </select>
        </label>
        <label className="field">Kind
          <select value={kind} onChange={(event) => { if (isKind(event.target.value)) setKind(event.target.value); }}>
            <option value="food">Food</option>
            <option value="drink">Drink</option>
          </select>
        </label>
        <label className="field">Calories
          <input inputMode="decimal" value={calories} onChange={(event) => setCalories(event.target.value)} />
        </label>
        <label className="field">Protein g
          <input inputMode="decimal" value={protein} onChange={(event) => setProtein(event.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={busy}>{current ? "Update staple" : "Save staple"}</button>
      </form>
      {current ? (
        <button type="button" className="text-button danger" disabled={busy} onClick={() => void onDelete(current)}>Delete this staple</button>
      ) : null}
    </details>
  );
}
