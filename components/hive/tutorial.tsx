"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { activeHivePlayer, applyHiveAction, HIVE_PIECES, hivePieceHint, hiveTargets, sameHex, type Hex } from "@/lib/hive";
import { createHiveLesson, HIVE_LESSONS } from "@/lib/hive-tutorial";
import { HiveBoard } from "./board";
import { HiveGlyph } from "./piece";

const lessonState = (index: number) => ({ index, ...createHiveLesson(index), selectedId: null as string | null, pending: null as Hex | null, done: false });

export function HiveTutorial({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState(() => lessonState(0));
  const lesson = HIVE_LESSONS[state.index];
  const namedPiece = `${["beetle", "grasshopper"].includes(lesson.piece) ? "deinen" : "deine"} ${HIVE_PIECES[lesson.piece].name}`;
  const piece = state.game.pieces.find((p) => p.id === state.pieceId)!;
  const selected = state.game.pieces.find((p) => p.id === state.selectedId);
  const hint = selected ? hivePieceHint(state.game, selected.id) : null;
  const targets = !state.done && state.selectedId === state.pieceId && lesson.to ? hiveTargets(state.game, state.pieceId).filter((to) => sameHex(to, lesson.to!)) : [];
  const choose = (selectedId: string) => setState((s) => ({ ...s, selectedId, pending: null, done: s.done || (lesson.kind === "blocked" && selectedId === s.pieceId) }));
  const confirm = () => {
    if (!state.pending || !lesson.to || !sameHex(state.pending, lesson.to)) return;
    const game = applyHiveAction(state.game, activeHivePlayer(state.game).id, { type: piece.position ? "move" : "place", pieceId: piece.id, to: state.pending, gameId: state.game.id, ply: state.game.ply });
    setState({ ...state, game, pending: null, selectedId: null, done: true });
  };
  return <section className={`hive-play hive-tutorial${selected ? " has-selection" : ""}${state.pending ? " has-pending" : ""}`} aria-label="HIVE lernen">
    <header className="hive-play-header"><div><span className="hive-kicker">Schritt {state.index + 1} von {HIVE_LESSONS.length} · Interaktive Übung</span><h1>{lesson.title}</h1></div><Button type="button" variant="outline" size="icon" aria-label="Übungsschritt wiederholen" onClick={() => setState(lessonState(state.index))}><RotateCcw /></Button></header>
    <div className="hive-tutorial-progress" role="progressbar" aria-label="Lernfortschritt" aria-valuemin={1} aria-valuemax={HIVE_LESSONS.length} aria-valuenow={state.index + 1} aria-valuetext={`Schritt ${state.index + 1} von ${HIVE_LESSONS.length}`}>{HIVE_LESSONS.map((item, i) => <span key={item.title} className={i < state.index ? "is-done" : i === state.index ? "is-current" : ""} aria-hidden="true" />)}</div>
    <p className="hive-tutorial-instruction">{lesson.instruction}</p>
    <div className="hive-play-grid">
      <HiveBoard game={state.game} selectedId={state.selectedId} targets={targets} pending={state.pending} busy={false} hint={hint} onSelect={choose} onTarget={(pending) => setState((s) => ({ ...s, pending }))} onInspectStack={(position) => { if (lesson.kind === "stack" && piece.position && sameHex(position, piece.position)) setState((s) => ({ ...s, done: true })); }} />
      <aside className="hive-play-sidebar"><div className="hive-move-dock hive-tutorial-dock">
        {lesson.kind === "place" && !state.done && <section className="hive-reserve-panel" aria-label="Übungsreserve"><Button type="button" variant="outline" className={`hive-tutorial-reserve${state.selectedId === piece.id ? " is-selected" : ""}`} aria-pressed={state.selectedId === piece.id} onClick={() => choose(piece.id)}><HiveGlyph kind={piece.kind} />{HIVE_PIECES[piece.kind].name} auswählen</Button></section>}
        <section className="hive-action-panel" aria-live="polite">
          {state.done ? <><h2>{state.index === HIVE_LESSONS.length - 1 ? <Trophy /> : <Check />}{state.index === HIVE_LESSONS.length - 1 ? "Du hast das Prinzip gelernt!" : "Geschafft!"}</h2><p>{lesson.success}</p><Button type="button" className="hive-primary hive-full" onClick={() => { if (state.index === HIVE_LESSONS.length - 1) onClose(); else setState(lessonState(state.index + 1)); }}>{state.index === HIVE_LESSONS.length - 1 ? "Zurück zu HIVE" : "Nächster Schritt"}<ArrowRight /></Button></> : <>
            <h2>{state.pending ? "Dein Zug als Vorschau" : "Du bist dran"}</h2>
            <p className={hint ? "hive-block-explanation" : undefined}>{hint ? hint.message : state.pending ? "Prüfe den transparenten Stein und bestätige deinen Zug." : state.selectedId && state.selectedId !== piece.id ? `Wähle für diesen Schritt ${namedPiece}.` : targets.length ? "Tippe auf das markierte Zielfeld." : lesson.kind === "stack" ? "Tippe auf den Käferstapel, um ihn zu öffnen." : lesson.kind === "place" ? "Wähle den Stein aus der Übungsreserve." : `Tippe auf ${namedPiece} auf dem Spielfeld.`}</p>
            {state.pending && <div className="hive-confirm-move"><Button type="button" variant="outline" onClick={() => setState((s) => ({ ...s, pending: null }))}>Abbrechen</Button><Button type="button" className="hive-primary" onClick={confirm}>Zug bestätigen<ArrowRight /></Button></div>}
          </>}
        </section>
      </div></aside>
    </div>
    <div className="hive-tutorial-footer"><Button type="button" variant="ghost" onClick={onClose}><ArrowLeft />Übung beenden</Button>{state.index > 0 && <Button type="button" variant="ghost" onClick={() => setState(lessonState(state.index - 1))}>Vorheriger Schritt</Button>}</div>
  </section>;
}
