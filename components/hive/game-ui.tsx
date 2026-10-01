"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, ChevronRight, CircleHelp, Flag, GraduationCap, Handshake, MoreHorizontal, RotateCcw, Trophy, Undo2, X } from "lucide-react";
import { ConfirmDialog, GameBackLink, GameDialog } from "@/components/game-entry";
import { Button } from "@/components/ui/button";
import { activeHivePlayer, canHivePass, canUndoHiveTurn, HIVE_KINDS, HIVE_PIECES, hivePieceHint, hiveTargets, queenPlaced, queenRequired, queenSurroundCount, type Hex, type HiveAction, type HiveGame } from "@/lib/hive";
import { HiveBoard } from "./board";
import { HiveGlyph } from "./piece";

export function HiveRulesContent() {
  return <div className="hive-rules-content">
    <p>Umzingelt die gegnerische Königin auf allen sechs Seiten. Dabei zählen Steine beider Farben. Sind beide Königinnen gleichzeitig eingeschlossen, endet die Partie unentschieden.</p>
    <ol>
      <li><strong>Setzen oder ziehen</strong><p>Pro Zug kommt ein Stein aus deiner Reserve hinzu oder du bewegst einen eigenen Stein. Weiß beginnt.</p></li>
      <li><strong>Die Königin zuerst absichern</strong><p>Setze sie spätestens in deinem vierten Zug. Erst wenn sie liegt, dürfen deine Steine ziehen.</p></li>
      <li><strong>Neue Steine anlegen</strong><p>Dein erster Stein darf an die andere Farbe grenzen. Danach setzt du nur neben eigene Steine. Bei Stapeln zählt die Farbe des obersten Steins.</p></li>
      <li><strong>Ein zusammenhängender Schwarm</strong><p>Der Schwarm darf auch während eines Zuges nie auseinanderfallen. Gleitende Steine bleiben am Schwarm und passen durch keine zu enge Lücke.</p></li>
    </ol>
    <div className="hive-insect-guide">{HIVE_KINDS.map((kind) => <div key={kind}><HiveGlyph kind={kind} /><span><strong>{HIVE_PIECES[kind].count} × {HIVE_PIECES[kind].name}</strong><p>{HIVE_PIECES[kind].rule}</p></span></div>)}</div>
    <p className="hive-muted">Ohne legalen Zug musst du passen. Ein Remis könnt ihr gemeinsam vereinbaren.</p>
    <a className="hive-source" href="https://www.gen42.com/wp-content/uploads/Hive_German_Rules.pdf" target="_blank" rel="noreferrer">Offizielle Spielregeln von Gen42 <ArrowRight aria-hidden="true" /></a>
  </div>;
}
export function HiveRules() {
  return <details className="hive-rules"><summary><BookOpen aria-hidden="true" /><span>So funktioniert HIVE</span><ChevronRight aria-hidden="true" /></summary><HiveRulesContent /></details>;
}

export function HiveGameUI({ game, meId, local = false, busy = false, connected = true, isHost = false, onAction, onRematch, onUndo, onTutorial }: {
  game: HiveGame; meId: string; local?: boolean; busy?: boolean; connected?: boolean; isHost?: boolean;
  onAction: (action: HiveAction) => Promise<boolean>; onRematch: () => void; onUndo?: () => boolean; onTutorial?: () => void;
}) {
  const [selection, setSelection] = useState<{ pieceId: string; ply: number } | null>(null);
  const [candidate, setCandidate] = useState<Extract<HiveAction, { type: "place" | "move" }> | null>(null);
  const [dialog, setDialog] = useState<"rules" | "menu" | "resign" | "draw" | "accept-draw" | "undo" | "piece" | null>(null);
  const current = activeHivePlayer(game); const me = game.players.find((p) => p.id === meId)!;
  const opponent = game.players.find((p) => p.id !== meId)!;
  const turn = game.phase === "playing" && current.id === meId;
  const playable = turn && !busy && connected;
  const piece = selection?.ply === game.ply ? game.pieces.find((p) => p.id === selection.pieceId) : undefined;
  const targets = piece && playable ? hiveTargets(game, piece.id) : [];
  const pending = candidate?.ply === game.ply && candidate.gameId === game.id && turn && connected ? candidate : null;
  const reserve = game.pieces.filter((p) => p.ownerId === meId && !p.position);
  const forcedQueen = turn && queenRequired(game, meId);
  const hint = piece ? hivePieceHint(game, piece.id) : null;
  const select = (pieceId: string) => { setSelection({ pieceId, ply: game.ply }); setCandidate(null); };
  const target = (to: Hex) => { if (piece && playable) setCandidate({ type: piece.position ? "move" : "place", gameId: game.id, ply: game.ply, pieceId: piece.id, to }); };
  const send = async (type: "pass" | "resign" | "offer-draw" | "cancel-draw") => { if (await onAction({ type, gameId: game.id, ply: game.ply })) setDialog(null); };
  const answerDraw = async (accept: boolean) => { if (await onAction({ type: "answer-draw", accept, gameId: game.id, ply: game.ply })) setDialog(null); };
  const winner = game.players.find((p) => p.id === game.result?.winnerId);
  const recent = [...game.history].reverse().slice(0, 12);
  let instruction = !turn ? `${current.name} ist am Zug. Du kannst dir die Steine ansehen.` : forcedQueen ? "Vierter Zug: Wähle deine Königin aus der Reserve." : "Wähle einen Stein aus deiner Reserve oder vom Spielfeld.";
  if (piece) instruction = piece.ownerId !== meId ? "Dieser Stein gehört der anderen Person." : !turn ? "Du kannst wieder ziehen, sobald du am Zug bist." : hint ? hint.message : targets.length === 1 ? "Tippe auf das markierte Zielfeld." : `Tippe auf eines der ${targets.length} markierten Zielfelder.`;

  return <section className={`hive-play${piece ? " has-selection" : ""}${pending ? " has-pending" : ""}`} aria-label="HIVE-Partie">
    <header className="hive-play-header"><div><span className="hive-kicker">{local ? "Ein Gerät für zwei" : "Online-Duell"} · Zug {game.ply + 1}</span><h1>{game.phase === "finished" ? "Partie beendet" : `${current.name} ist am Zug`}</h1></div><div className="hive-play-tools">{local && onUndo && <Button type="button" variant="outline" size="icon" aria-label="Letzten Zug zurücknehmen" disabled={busy || !canUndoHiveTurn(game)} onClick={() => setDialog("undo")}><Undo2 /></Button>}<Button type="button" variant="outline" size="icon" aria-label="Spielregeln öffnen" onClick={() => setDialog("rules")}><BookOpen /></Button><Button type="button" variant="outline" size="icon" aria-label="Partiemenü öffnen" onClick={() => setDialog("menu")}><MoreHorizontal /></Button></div></header>
    <div className="hive-player-strip">{game.players.map((player) => {
      const count = queenSurroundCount(game, player.id); const queen = queenPlaced(game, player.id);
      return <div key={player.id} className={`hive-player-summary${current.id === player.id && game.phase === "playing" ? " is-current" : ""}${count >= 5 ? " is-danger" : ""}`}>
        <span className={`hive-color-dot is-${player.color}`} aria-hidden="true" /><div><strong>{player.name}{!local && meId === player.id ? " (du)" : ""}</strong><span>{player.color === "white" ? "Weiß" : "Schwarz"} · {queen ? `Königin: ${count}/6 umringt` : `Königin noch in Reserve`}</span></div>
        <span className="hive-queen-status" aria-label={queen ? `${6 - count} freie Seiten der Königin` : "Königin nicht gesetzt"}>{queen ? Array.from({ length: 6 }, (_, i) => <i key={i} className={i < count ? " is-filled" : ""} />) : <HiveGlyph kind="queen" />}</span>
      </div>;
    })}</div>
    {game.drawOffer && game.phase === "playing" && <div className="hive-draw-notice" role="status"><Handshake aria-hidden="true" /><p>{game.drawOffer === meId ? "Du hast ein Remis angeboten." : `${opponent.name} bietet ein Remis an.`}</p>{game.drawOffer === meId ? <Button type="button" variant="outline" disabled={busy || !connected} onClick={() => void send("cancel-draw")}>Zurückziehen</Button> : <><Button type="button" variant="outline" disabled={busy || !connected} onClick={() => void answerDraw(false)}>Weiterspielen</Button><Button type="button" className="hive-primary" disabled={busy || !connected} onClick={() => setDialog("accept-draw")}>Remis annehmen</Button></>}</div>}
    {game.phase === "finished" && <div className="hive-result" role="status"><Trophy aria-hidden="true" /><div><h2>{winner ? `${winner.name} gewinnt!` : "Unentschieden!"}</h2><p>{game.result?.reason === "resigned" ? "Die andere Person hat aufgegeben." : game.result?.reason === "both-surrounded" ? "Beide Königinnen wurden gleichzeitig umzingelt." : game.result?.reason === "agreement" ? "Ihr habt euch auf ein Remis geeinigt." : "Die gegnerische Königin ist auf allen sechs Seiten umzingelt."}</p></div>{local || isHost ? <Button type="button" className="hive-primary" disabled={busy || !connected} onClick={onRematch}><RotateCcw />{local ? "Revanche spielen" : "Lobby für Revanche öffnen"}</Button> : <p className="hive-muted">Der Lobby-Master kann die Lobby für eine Revanche öffnen.</p>}</div>}
    <div className="hive-play-grid">
      <HiveBoard game={game} selectedId={piece?.id ?? null} targets={targets} pending={pending?.to ?? null} hint={hint} busy={busy} onSelect={select} onTarget={target} />
      <aside className="hive-play-sidebar">
        <div className="hive-move-dock">
        <section className="hive-reserve-panel" aria-label={`Reserve von ${me.name}`}><div className="hive-section-label"><h2>{local ? `${me.name}s Reserve` : "Deine Reserve"}</h2><span>{reserve.length} Steine</span></div>
          <div className={`hive-reserve is-${me.color}`}>{HIVE_KINDS.map((kind) => {
            const available = reserve.filter((p) => p.kind === kind); const selected = Boolean(piece && !piece.position && piece.kind === kind && piece.ownerId === meId);
            return <Button key={kind} type="button" variant="outline" className={`hive-reserve-piece${selected ? " is-selected" : ""}`} disabled={!playable || !available.length || (forcedQueen && kind !== "queen")} aria-pressed={selected} aria-label={`${HIVE_PIECES[kind].name}, ${available.length} in Reserve`} onClick={() => select(available[0].id)}><span className="hive-mini-tile"><HiveGlyph kind={kind} /><b>{available.length}</b></span><span>{kind === "grasshopper" ? "Hüpfer" : HIVE_PIECES[kind].name}</span></Button>;
          })}</div>
          {game.phase === "playing" && <div className={`hive-turn-hint${forcedQueen ? " is-required" : ""}`} role="status">{forcedQueen ? "Vierter Zug: Setze jetzt deine Königin." : !queenPlaced(game, meId) && turn ? `Königin spätestens in Zug 4 setzen · dein Zug ${me.turns + 1}` : turn ? "Du kannst setzen oder ziehen." : "Die andere Person spielt gerade."}</div>}
        </section>
        {game.phase === "playing" && <section className={`hive-action-panel${pending ? " has-pending" : ""}`} aria-label="Dein nächster Zug" aria-live="polite">
          {piece ? <><div className="hive-selected-heading"><HiveGlyph kind={piece.kind} /><strong>{HIVE_PIECES[piece.kind].name}</strong><Button type="button" variant="ghost" size="icon" aria-label={`Bewegungsregel für ${HIVE_PIECES[piece.kind].name} ansehen`} onClick={() => setDialog("piece")}><CircleHelp /></Button><Button type="button" variant="ghost" size="icon" aria-label="Steinauswahl aufheben" onClick={() => { setSelection(null); setCandidate(null); }}><X /></Button></div><p className="hive-piece-rule">{HIVE_PIECES[piece.kind].rule}</p></> : <h2>{turn ? "Dein nächster Zug" : "Warten auf den Zug"}</h2>}
          <p className={hint ? "hive-block-explanation" : undefined}>{pending ? `${HIVE_PIECES[piece!.kind].name} ${pending.type === "place" ? "auf das markierte Feld setzen" : "auf das markierte Feld ziehen"}?` : instruction}</p>
          {pending && <div className="hive-confirm-move"><Button type="button" variant="outline" disabled={busy} onClick={() => setCandidate(null)}>Abbrechen</Button><Button type="button" className="hive-primary" disabled={busy || !connected} onClick={() => void onAction(pending)}>{busy ? "Wird bestätigt …" : "Zug bestätigen"}<ArrowRight /></Button></div>}
          {turn && canHivePass(game) && <><p>Du kannst weder setzen noch ziehen. Dein Zug muss aussetzen.</p><Button type="button" className="hive-primary" disabled={!playable} onClick={() => void send("pass")}>Zug passen</Button></>}
        </section>}
        </div>
        <section className="hive-opponent-reserve" aria-label={`Reserve von ${opponent.name}`}><div className="hive-section-label"><h2>{opponent.name}s Reserve</h2><span>{game.pieces.filter((p) => p.ownerId === opponent.id && !p.position).length} Steine</span></div><div>{HIVE_KINDS.map((kind) => <span key={kind} title={HIVE_PIECES[kind].name}><HiveGlyph kind={kind} /><b>{game.pieces.filter((p) => p.ownerId === opponent.id && p.kind === kind && !p.position).length}</b></span>)}</div></section>
        {game.history.length > 0 && <p className="hive-last-turn">{lastTurnText(game, game.history[game.history.length - 1])}</p>}
      </aside>
    </div>
    {dialog === "rules" && <GameDialog theme="hive" kicker="Grundspiel · 22 Steine" title="So funktioniert HIVE" onClose={() => setDialog(null)}><HiveRulesContent /></GameDialog>}
    {dialog === "piece" && piece && <GameDialog theme="hive" kicker="Bewegungsregel" title={HIVE_PIECES[piece.kind].name} onClose={() => setDialog(null)}><div className="hive-piece-help"><HiveGlyph kind={piece.kind} /><p>{HIVE_PIECES[piece.kind].rule}</p></div>{hint && <p className="hive-block-explanation">{hint.message}</p>}</GameDialog>}
    {dialog === "menu" && <GameDialog theme="hive" kicker="HIVE" title="Deine Partie" onClose={() => setDialog(null)}>
      {onTutorial && <Button type="button" variant="outline" onClick={() => { setDialog(null); onTutorial(); }}><GraduationCap />HIVE Schritt für Schritt lernen</Button>}
      {game.phase === "playing" && <><Button type="button" variant="outline" disabled={busy || !connected || !turn || Boolean(game.drawOffer)} onClick={() => setDialog("draw")}><Handshake />{local ? "Remis vereinbaren" : "Remis anbieten"}</Button><Button type="button" variant="outline" disabled={busy || !connected} onClick={() => setDialog("resign")}><Flag />Aufgeben</Button></>}
      {recent.length > 0 && <details className="hive-history"><summary>Letzte Züge <ChevronRight /></summary><ol>{recent.map((entry) => <li key={entry.ply}><span>{entry.ply}.</span>{lastTurnText(game, entry)}</li>)}</ol></details>}
      <GameBackLink /><p className="hive-muted">Die Partie bleibt gespeichert, wenn du zur Spielauswahl zurückkehrst.</p>
    </GameDialog>}
    {dialog === "resign" && <ConfirmDialog theme="hive" title={`${me.name}, wirklich aufgeben?`} description={`${opponent.name} gewinnt dann diese Partie.`} confirmLabel="Partie aufgeben" busy={busy} onCancel={() => setDialog(null)} onConfirm={() => void send("resign")} />}
    {dialog === "draw" && <ConfirmDialog theme="hive" title={local ? "Seid ihr beide mit einem Remis einverstanden?" : "Ein Remis anbieten?"} description={local ? "Wenn ihr beide zustimmt, endet diese Partie unentschieden." : "Die andere Person kann dein Angebot annehmen oder weiterspielen. Ein Angebot verbraucht keinen Zug."} confirmLabel={local ? "Partie unentschieden beenden" : "Remis anbieten"} tone="accept" busy={busy} onCancel={() => setDialog(null)} onConfirm={() => void send("offer-draw")} />}
    {dialog === "accept-draw" && <ConfirmDialog theme="hive" title="Remis annehmen?" description="Die Partie endet dann unentschieden." confirmLabel="Remis annehmen" tone="accept" busy={busy} onCancel={() => setDialog(null)} onConfirm={() => void answerDraw(true)} />}
    {dialog === "undo" && local && onUndo && <ConfirmDialog theme="hive" title="Letzten Zug zurücknehmen?" description="Wenn ihr beide einverstanden seid, wird der letzte Spielzug rückgängig gemacht. Die Person, die ihn gespielt hat, ist wieder am Zug." confirmLabel="Zug zurücknehmen" confirmIcon={<Undo2 />} tone="accept" busy={busy} onCancel={() => setDialog(null)} onConfirm={() => { if (onUndo()) { setSelection(null); setCandidate(null); setDialog(null); } }} />}
  </section>;
}
function lastTurnText(game: HiveGame, entry: HiveGame["history"][number]) {
  const name = game.players.find((p) => p.id === entry.playerId)?.name ?? "Person";
  const piece = game.pieces.find((p) => p.id === entry.pieceId);
  return entry.type === "pass" ? `${name} hat gepasst.` : `${name}: ${piece ? HIVE_PIECES[piece.kind].name : "Stein"} ${entry.type === "place" ? "gesetzt" : "gezogen"}.`;
}
