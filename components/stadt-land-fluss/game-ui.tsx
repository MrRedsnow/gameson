"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, CircleHelp, Flag, Plus, Settings2, Timer, TimerOff, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { challengeKey, formatTime, remainingSeconds, validInitial, validateSettings, voteSummary, type SlfAction, type SlfSettings, type SlfState, type SlfView } from "@/lib/stadt-land-fluss";

export type SlfSend = (action: string, extra?: Record<string, unknown>, quiet?: boolean) => Promise<boolean>;
export type ServerClock = { server: number; at: number };
export function useServerNow(clock: ServerClock) {
  const [now, setNow] = useState(clock.server);
  useEffect(() => {
    const update = () => setNow(clock.server + performance.now() - clock.at);
    const frame = requestAnimationFrame(update); const interval = setInterval(update, 100);
    return () => { cancelAnimationFrame(frame); clearInterval(interval); };
  }, [clock]);
  return now;
}

export function SlfTimerBar({ state, now, connected, onEdit }: { state: SlfState; now: number; connected: boolean; onEdit: () => void }) {
  const bar = useRef<HTMLElement>(null); const game = state.game;
  const seconds = game?.phase === "writing" ? remainingSeconds(game.round.endsAt, now) : null;
  const disabled = game?.phase === "writing" ? game.round.endsAt === null : state.lobby.settings.timerSeconds === null;
  const label = !game ? "Rundenzeit" : game.phase === "writing" ? "Restzeit" : game.phase === "review" ? "Abstimmung" : "Runde beendet";
  // On mobile Safari the keyboard can pan the visual viewport independently of the layout viewport.
  useEffect(() => {
    const viewport = window.visualViewport;
    const pin = () => { bar.current?.style.setProperty("--slf-viewport-top", `${viewport?.offsetTop ?? 0}px`); };
    pin(); viewport?.addEventListener("resize", pin); viewport?.addEventListener("scroll", pin);
    return () => { viewport?.removeEventListener("resize", pin); viewport?.removeEventListener("scroll", pin); };
  }, []);
  return <header ref={bar} className={`slf-timer-bar${seconds !== null && seconds <= 10 ? " is-urgent" : ""}`} aria-label="Runde und Timer">
    <div className="slf-timer-inner">
      <div className="slf-round-letter" aria-label={game ? `Buchstabe ${game.round.letter}` : "Stadt Land Fluss"}>{game?.round.letter ?? "Aa"}</div>
      <div className="slf-round-meta"><strong>{game ? `Runde ${game.round.number} / ${game.rounds}` : "Eure Lobby"}</strong><span>{connected ? game?.phase === "writing" ? "Alle schreiben gleichzeitig" : state.lobby.name : "Verbindung unterbrochen"}</span></div>
      <div className="slf-clock"><span>{disabled && (!game || game.phase === "writing") ? <TimerOff aria-hidden="true" /> : <Timer aria-hidden="true" />}{label}</span><strong role="timer" aria-live="off" aria-label={seconds !== null ? `${seconds} Sekunden verbleibend` : undefined}>{game?.phase === "writing" ? seconds === null ? "Ohne Limit" : formatTime(seconds) : !game ? disabled ? "Ohne Limit" : formatTime(state.lobby.settings.timerSeconds!) : "–:–"}</strong></div>
      {state.me.id === state.lobby.hostPlayerId && <Button type="button" variant="ghost" size="icon" onClick={onEdit} aria-label="Timer bearbeiten" title="Timer bearbeiten"><Settings2 aria-hidden="true" /></Button>}
    </div>
  </header>;
}

export function SlfSettingsForm({ value, busy, roundsLocked = false, onSave }: { value: SlfSettings; busy: boolean; roundsLocked?: boolean; onSave: (settings: SlfSettings) => Promise<boolean> }) {
  const [columns, setColumns] = useState(value.columns); const [seconds, setSeconds] = useState(String(value.timerSeconds ?? 120));
  const [enabled, setEnabled] = useState(value.timerSeconds !== null); const [rounds, setRounds] = useState(String(value.rounds)); const [error, setError] = useState("");
  return <form className="slf-settings-form" onSubmit={(event) => { event.preventDefault(); try { const settings = validateSettings({ columns, timerSeconds: enabled ? Number(seconds) : null, rounds: Number(rounds) }); setError(""); void onSave(settings); } catch (e) { setError((e as Error).message); } }}>
    <fieldset disabled={busy}><legend>Eigene Spalten <span>{columns.length} / 12</span></legend><p>Alles ist erlaubt: Klassiker, Essen oder euer Insiderwissen.</p>
      <div className="slf-column-editor">{columns.map((column, i) => <div key={i}><span>{String(i + 1).padStart(2, "0")}</span><Input aria-label={`Spalte ${i + 1}`} value={column} required maxLength={30} onChange={(e) => setColumns(columns.map((v, j) => j === i ? e.target.value : v))} /><Button type="button" size="icon" variant="ghost" disabled={columns.length <= 2} aria-label={`Spalte ${i + 1} entfernen`} onClick={() => setColumns(columns.filter((_, j) => j !== i))}><X aria-hidden="true" /></Button></div>)}</div>
      {columns.length < 12 && <Button type="button" variant="outline" onClick={() => setColumns([...columns, ""])}><Plus aria-hidden="true" />Spalte hinzufügen</Button>}
    </fieldset>
    <fieldset disabled={busy}><legend>Tempo &amp; Runden</legend><label className="slf-switch" htmlFor="slf-settings-timer"><span><strong>Timer aktiv</strong><small>Für alle Geräte dieselbe Restzeit.</small></span><Switch id="slf-settings-timer" checked={enabled} onCheckedChange={setEnabled} aria-label="Timer aktiv" /></label>
      <div className="slf-setting-grid">{enabled && <label className="slf-field" htmlFor="slf-settings-seconds"><span>Sekunden pro Runde</span><Input id="slf-settings-seconds" type="number" min={15} max={1800} step={1} required value={seconds} onChange={(e) => setSeconds(e.target.value)} /></label>}<label className="slf-field" htmlFor="slf-settings-rounds"><span>Anzahl der Runden</span><Input id="slf-settings-rounds" type="number" min={1} max={20} step={1} required disabled={roundsLocked} value={rounds} onChange={(e) => setRounds(e.target.value)} /></label></div>
    </fieldset>
    {error && <p role="alert" className="slf-error">{error}</p>}<Button className="slf-primary" type="submit" disabled={busy}>{busy ? "Wird gespeichert …" : "Einstellungen speichern"}</Button>
  </form>;
}

export function SlfTimerDialog({ state, busy, send, onClose }: { state: SlfState; busy: boolean; send: SlfSend; onClose: () => void }) {
  const [enabled, setEnabled] = useState(state.lobby.settings.timerSeconds !== null); const [seconds, setSeconds] = useState(String(state.lobby.settings.timerSeconds ?? 120));
  const writing = state.game?.phase === "writing";
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="slf-theme slf-dialog game-dialog"><DialogTitle>Timer bearbeiten</DialogTitle><DialogDescription>{writing ? "Die neue Restzeit gilt ab dem Speichern für alle. Sie wird auch für die nächsten Runden übernommen." : "Lege die Zeit für die nächste Runde fest. Ohne Timer endet die Schreibphase, wenn alle abgeben oder du sie beendest."}</DialogDescription>
    <form onSubmit={(e) => { e.preventDefault(); void send("timer", { roundId: state.game?.round.id, timerSeconds: enabled ? Number(seconds) : null }).then((ok) => { if (ok) onClose(); }); }}>
      <label className="slf-switch" htmlFor="slf-timer-enabled"><strong>Timer aktiv</strong><Switch id="slf-timer-enabled" checked={enabled} onCheckedChange={setEnabled} aria-label="Timer aktiv" /></label>
      {enabled && <label className="slf-field"><span>{writing ? "Neue Restzeit in Sekunden" : "Sekunden pro Runde"}</span><Input type="number" min={15} max={1800} required step={1} value={seconds} onChange={(e) => setSeconds(e.target.value)} /></label>}
      <Button className="slf-primary" type="submit" disabled={busy}>{enabled ? "Timer für alle speichern" : "Timer für alle deaktivieren"}</Button>
    </form>
  </DialogContent></Dialog>;
}

export function SlfAnswerSheet({ game, meId, now, send, connected, isHost }: { game: SlfView; meId: string; now: number; send: SlfSend; connected: boolean; isHost: boolean }) {
  const own = game.round.answers[meId]; const key = `gameson-slf-draft:${game.id}:${game.round.id}:${meId}`;
  const [values, setValues] = useState(own.values); const [saved, setSaved] = useState(true); const [sending, setSending] = useState(false); const [submitting, setSubmitting] = useState(false); const [storageError, setStorageError] = useState(false);
  const draft = useRef({ values: own.values, sequence: own.sequence }); const committed = useRef(own.sequence);
  const pending = useRef<Promise<boolean> | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true); const locked = useRef(false); const flushRef = useRef<() => Promise<boolean>>(async () => false);
  const seconds = remainingSeconds(game.round.endsAt, now); const expired = seconds === 0;
  const disabled = own.submitted || expired || submitting;
  // Coalesce rapid typing, keep just one in-flight save per device, and give every snapshot a monotonic sequence.
  async function flush(): Promise<boolean> {
    if (pending.current) { const ok = await pending.current; return ok && draft.current.sequence > committed.current ? flushRef.current() : ok; }
    if (locked.current || draft.current.sequence <= committed.current) return true;
    const snapshot = { values: [...draft.current.values], sequence: draft.current.sequence };
    setSending(true);
    const work = send("move", { move: { type: "answers", roundId: game.round.id, ...snapshot } }, true);
    pending.current = work; const ok = await work; pending.current = null;
    if (!alive.current) return ok;
    if (ok) committed.current = Math.max(committed.current, snapshot.sequence);
    setSending(false); setSaved(ok && draft.current.sequence <= committed.current);
    if (ok && draft.current.sequence > committed.current) return flushRef.current();
    return ok;
  }
  useEffect(() => { flushRef.current = flush; });
  useEffect(() => {
    alive.current = true;
    const frame = requestAnimationFrame(() => {
      try {
        const raw = localStorage.getItem(key); const stored = raw ? JSON.parse(raw) : null;
        if (!own.submitted && stored && Number.isSafeInteger(stored.sequence) && stored.sequence > draft.current.sequence && Array.isArray(stored.values) && stored.values.length === own.values.length && stored.values.every((v: unknown) => typeof v === "string" && v.length <= 80)) {
          draft.current = stored; setValues(stored.values); setSaved(false); void flushRef.current();
        }
      } catch { setStorageError(true); }
    });
    const retry = setInterval(() => { if (!locked.current) void flushRef.current(); }, 1200);
    const hide = () => { if (document.hidden) void flushRef.current(); };
    document.addEventListener("visibilitychange", hide);
    return () => { alive.current = false; cancelAnimationFrame(frame); clearInterval(retry); if (timer.current) clearTimeout(timer.current); document.removeEventListener("visibilitychange", hide); };
    // The sheet is keyed by round ID and owns this round's local draft for its entire lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    locked.current = own.submitted || expired;
    if (own.submitted) { try { localStorage.removeItem(key); } catch { /* Session is already on the server. */ } }
  }, [own.submitted, expired, key]);
  function change(index: number, value: string) {
    const next = draft.current.values.map((v, i) => i === index ? value : v);
    draft.current = { values: next, sequence: Math.max(draft.current.sequence, own.sequence) + 1 }; setValues(next); setSaved(false);
    try { localStorage.setItem(key, JSON.stringify(draft.current)); } catch { setStorageError(true); }
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; void flushRef.current(); }, 120);
  }
  async function submit() {
    if (submitting || disabled) return; setSubmitting(true);
    if (pending.current) await pending.current;
    const sequence = Math.max(draft.current.sequence, own.sequence) + 1;
    draft.current.sequence = sequence;
    const ok = await send("move", { move: { type: "answers", roundId: game.round.id, values: draft.current.values, sequence, submit: true } });
    if (ok) { locked.current = true; committed.current = sequence; setSaved(true); }
    setSubmitting(false);
  }
  const completed = values.filter((value) => value.trim()).length;
  return <section className="slf-answer-sheet" aria-labelledby="slf-sheet-title">
    <div className="slf-section-heading"><div><span className="slf-kicker">Stifte raus. Köpfe an.</span><h1 id="slf-sheet-title">Alles mit <em>{game.round.letter}</em>.</h1></div><span className="slf-count">{completed} / {values.length}</span></div>
    <p className="slf-muted">Deine Antworten bleiben bis zur Auswertung geheim.</p>
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="slf-answer-fields">{game.round.columns.map((column, i) => <label className="slf-answer-field" key={i}><span className="slf-field-number">{String(i + 1).padStart(2, "0")}</span><span className="slf-answer-label">{column}</span><Input aria-label={column} autoComplete="off" autoCorrect="off" spellCheck={false} autoCapitalize="words" enterKeyHint={i === values.length - 1 ? "done" : "next"} maxLength={80} disabled={disabled} value={values[i]} placeholder={`${column} mit ${game.round.letter} …`} onChange={(e) => change(i, e.target.value)} onBlur={() => void flushRef.current()} onKeyDown={(e) => { if (e.key === "Enter" && i < values.length - 1) { e.preventDefault(); const inputs = e.currentTarget.form?.querySelectorAll("input"); (inputs?.[i + 1] as HTMLInputElement | undefined)?.focus(); } }} /></label>)}</div>
      <div className="slf-save-status" role="status" aria-live="polite">{own.submitted ? <><Check aria-hidden="true" />Abgegeben. Warte auf die anderen.</> : expired ? "Zeit vorbei. Die Auswertung wird geladen …" : sending ? "Antworten werden gespeichert …" : !saved ? connected ? "Änderungen werden gespeichert …" : "Noch nicht gespeichert. Verbindung wird wiederhergestellt …" : <><Check aria-hidden="true" />Alle Antworten gespeichert</>}</div>
      {storageError && <p className="slf-error">Lokales Zwischenspeichern ist nicht möglich. Lass diese Seite bis zur Abgabe geöffnet.</p>}
      <Button className="slf-primary" type="submit" disabled={disabled || !connected}><Check aria-hidden="true" />{own.submitted ? "Du bist fertig" : submitting ? "Wird abgegeben …" : "Fertig – Antworten abgeben"}</Button>
    </form>
    <p className="slf-muted slf-small">Abgegebene Antworten sind fest. Wenn alle fertig sind, beginnt die Auswertung.</p>
    <div className="slf-writing-players" aria-label="Abgaben">{game.players.map((p) => <span key={p.id} className={game.progress.find((item) => item.id === p.id)?.submitted ? "is-done" : ""}>{game.progress.find((item) => item.id === p.id)?.submitted && <Check aria-hidden="true" />}{p.name}</span>)}</div>
    {isHost && <Button type="button" variant="outline" className="slf-stop" disabled={expired || submitting || !connected} onClick={() => { void flushRef.current().then((ok) => { if (ok) void send("move", { move: { type: "stop", roundId: game.round.id } }); }); }}><Flag aria-hidden="true" />Schreibphase für alle beenden</Button>}
  </section>;
}

export function SlfReview({ game, meId, isHost, busy, send }: { game: SlfView; meId: string; isHost: boolean; busy: boolean; send: SlfSend }) {
  const [column, setColumn] = useState(0); const [force, setForce] = useState(false);
  const reviewing = game.phase === "review"; const challenges = Object.values(game.round.challenges);
  const votesMissing = challenges.filter((c) => typeof c.votes[meId] !== "boolean").length;
  const allReady = game.round.ready.length === game.players.length; const ready = game.round.ready.includes(meId);
  const move = (action: Omit<SlfAction, "roundId"> | Record<string, unknown>) => send("move", { move: { ...action, roundId: game.round.id } });
  return <section className="slf-review" aria-labelledby="slf-review-title">
    <span className="slf-kicker">{reviewing ? "Gemeinsam entscheiden" : "Eure Antworten"}</span><h1 id="slf-review-title">{reviewing ? "Gilt das? Ihr entscheidet." : `Runde ${game.round.number} im Überblick.`}</h1>
    <p className="slf-muted">{reviewing ? "Tippe zweifelhafte Antworten an. Bei einer Abstimmung zählen Ja und Nein – bei Gleichstand gilt die Antwort." : "Die Punkte dieser Runde sind gespeichert."}</p>
    <div className="slf-category-tabs" role="tablist" aria-label="Spalte auswerten">{game.round.columns.map((label, i) => {
      const missing = challenges.filter((c) => c.column === i && typeof c.votes[meId] !== "boolean").length;
      return <button type="button" key={i} role="tab" aria-selected={column === i} aria-controls={`slf-column-${i}`} id={`slf-tab-${i}`} tabIndex={column === i ? 0 : -1} onClick={() => setColumn(i)} onKeyDown={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? 0 : e.key === "End" ? game.round.columns.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + game.round.columns.length) % game.round.columns.length; setColumn(next); document.getElementById(`slf-tab-${next}`)?.focus(); } }}>{label}{reviewing && missing > 0 && <span aria-label={`${missing} offene Abstimmungen`}>{missing}</span>}</button>;
    })}</div>
    <div className="slf-review-column" id={`slf-column-${column}`} role="tabpanel" aria-labelledby={`slf-tab-${column}`} tabIndex={0}>
      <div className="slf-section-heading"><h2>{game.round.columns[column]}</h2><span>mit {game.round.letter}</span></div>
      {game.players.map((player) => {
        const answer = game.round.answers[player.id].values[column]; const valid = validInitial(answer, game.round.letter);
        const challenge = game.round.challenges[challengeKey(player.id, column)]; const summary = challenge ? voteSummary(challenge) : null;
        return <article key={player.id} className={`slf-review-answer${challenge ? " is-challenged" : ""}${!valid ? " is-empty" : ""}`}>
          <div className="slf-answer-owner"><span>{player.name}{player.id === meId ? " (du)" : ""}</span>{!reviewing && <strong>{game.round.points[player.id]?.[column] ?? 0} P.</strong>}</div>
          <div className="slf-answer-word"><strong>{answer || "Keine Antwort"}</strong>{reviewing && valid && !challenge && <Button type="button" variant="outline" disabled={busy} onClick={() => void move({ type: "challenge", playerId: player.id, column })} aria-label={`${answer} von ${player.name} anzweifeln`}><CircleHelp aria-hidden="true" />Anzweifeln</Button>}</div>
          {!valid && <p className="slf-small">{answer ? `Beginnt nicht mit ${game.round.letter}` : "Leer abgegeben"} · 0 Punkte</p>}
          {challenge && summary && <div className="slf-ballot">
            {reviewing && <div className="slf-ballot-buttons"><Button type="button" disabled={busy} variant="outline" aria-pressed={challenge.votes[meId] === true} onClick={() => void move({ type: "vote", playerId: player.id, column, valid: true })} aria-label={`${answer} von ${player.name}: Gilt`}><Check aria-hidden="true" />Gilt</Button><Button type="button" disabled={busy} variant="outline" aria-pressed={challenge.votes[meId] === false} onClick={() => void move({ type: "vote", playerId: player.id, column, valid: false })} aria-label={`${answer} von ${player.name}: Gilt nicht`}><X aria-hidden="true" />Gilt nicht</Button></div>}
            <p>{summary.yes} Ja · {summary.no} Nein · {summary.total} / {game.players.length} Stimmen{!reviewing && ` · ${summary.valid ? "Gilt" : "Gilt nicht"}`}</p>
          </div>}
        </article>;
      })}
    </div>
    {reviewing && <div className="slf-panel slf-review-actions"><strong>{game.round.ready.length} / {game.players.length} haben die Wertung bestätigt</strong>
      {votesMissing > 0 && <p>Stimme noch über {votesMissing} {votesMissing === 1 ? "Antwort" : "Antworten"} ab. Die markierten Spalten zeigen dir, wo.</p>}
      <Button type="button" className="slf-primary" disabled={busy || votesMissing > 0 || ready} onClick={() => void move({ type: "ready" })}><Check aria-hidden="true" />{ready ? "Du hast bestätigt" : "Wertung bestätigen"}</Button>
      {isHost && <><Button type="button" className="slf-primary" disabled={busy || !allReady} onClick={() => void move({ type: "score" })}><Trophy aria-hidden="true" />Punkte auswerten</Button>{!allReady && <Button type="button" variant="ghost" disabled={busy} onClick={() => setForce(true)}>Mit bisherigen Stimmen abschließen …</Button>}</>}
      {!isHost && ready && <p>Der Lobby-Master schließt die Wertung ab. Neue Zweifel öffnen die Bestätigung für alle erneut.</p>}
    </div>}
    <Dialog open={force} onOpenChange={setForce}><DialogContent className="slf-theme slf-dialog game-dialog"><DialogTitle>Wertung vorzeitig abschließen?</DialogTitle><DialogDescription>Noch nicht alle sind fertig. Nur die bisher abgegebenen Stimmen zählen. Fehlende Stimmen werden nicht als Nein gewertet; bei Gleichstand gilt die Antwort. Danach kann niemand mehr abstimmen.</DialogDescription><Button type="button" variant="outline" onClick={() => setForce(false)}>Weiter abstimmen</Button><Button type="button" disabled={busy} onClick={() => void move({ type: "score", force: true }).then((ok) => { if (ok) setForce(false); })}>Mit bisherigen Stimmen auswerten</Button></DialogContent></Dialog>
  </section>;
}

export function SlfScoreboard({ game }: { game: SlfView }) {
  const sorted = [...game.players].sort((a, b) => game.scores[b.id] - game.scores[a.id]);
  return <section className="slf-panel slf-scoreboard" aria-label="Punktestand"><div className="slf-section-heading"><h2><Trophy aria-hidden="true" />{game.phase === "finished" ? "Das Endergebnis" : "Punktestand"}</h2><span>{game.history.length} Runden</span></div>
    <ol>{sorted.map((player, i) => { const rank = sorted.findIndex((p) => game.scores[p.id] === game.scores[player.id]) + 1; return <li key={player.id} className={i === 0 && game.history.length ? "is-leading" : ""}><span>{rank}.</span><strong>{player.name}</strong><small>{game.history.length > 0 ? `+${game.history.at(-1)?.scores[player.id] ?? 0} zuletzt` : ""}</small><b>{game.scores[player.id]} <small>P.</small></b></li>; })}</ol>
    {game.history.length > 1 && <details><summary>Rundenverlauf</summary><div className="slf-history">{game.history.map((round) => <div key={round.number}><strong>Runde {round.number} · {round.letter}</strong><p>{sorted.map((p) => `${p.name}: ${round.scores[p.id]}`).join(" · ")}</p></div>)}</div></details>}
  </section>;
}

export function SlfRules() {
  return <details className="slf-panel slf-rules"><summary><BookOpen aria-hidden="true" />So funktioniert’s</summary><div><ol>
    <li><strong>Spalten festlegen.</strong> Der Lobby-Master bestimmt 2–12 Kategorien, Rundenzahl und Timer. Alle spielen auf ihrem eigenen Gerät.</li>
    <li><strong>Gleichzeitig schreiben.</strong> Jede Runde bekommt einen neuen Buchstaben. Antworten werden automatisch gespeichert. „Fertig“ gibt deine Antworten verbindlich ab. Sind alle fertig, läuft die Zeit ab oder beendet der Lobby-Master die Schreibphase, geht es zur Auswertung.</li>
    <li><strong>Zweifel antippen.</strong> Tippt „Anzweifeln“ und stimmt mit „Gilt“ oder „Gilt nicht“ ab. Alle haben eine Stimme, auch die Person mit der Antwort. Stimmen lassen sich bis zum Abschluss ändern. Bei Gleichstand gilt die Antwort.</li>
    <li><strong>Punkte sammeln.</strong> 20 Punkte für die einzige gültige Antwort einer Spalte, 10 für eine einzigartige und 5 für eine gleiche Antwort. Leer, falscher Anfangsbuchstabe oder abgelehnt: 0. Großschreibung und Umlaute werden angeglichen (Ä = A, Ö = O, Ü = U).</li>
  </ol><p>Der Timer bleibt oben sichtbar. Der Lobby-Master kann die Restzeit jederzeit neu setzen oder deaktivieren. Spalten lassen sich zwischen den Runden ändern. Für das gemeinsame Spiel braucht ihr eine Internetverbindung.</p></div></details>;
}
