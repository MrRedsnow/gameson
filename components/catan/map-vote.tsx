"use client";

import { Button } from "@/components/ui/button";
import { mapVoteProgress, type CatanView } from "@/lib/catan";
import type { Send } from "./play-primitives";

export function MapVoteActions({ game, send, busy }: { game: CatanView; send: Send; busy: boolean }) {
  const vote = game.mapVote!; const progress = mapVoteProgress(game);
  if (progress.tied && game.me!.id === vote.hostPlayerId) return <>
    <Button className="catan-primary" disabled={busy} onClick={() => void send({ type: "resolve_map_tie", mapId: vote.id, accept: true })}>Karte annehmen</Button>
    <Button variant="outline" disabled={busy} onClick={() => void send({ type: "resolve_map_tie", mapId: vote.id, accept: false })}>Neue Karte</Button>
  </>;
  if (Object.hasOwn(vote.votes, game.me!.id)) return null;
  return <>
    <Button className="catan-primary" disabled={busy} onClick={() => void send({ type: "map_vote", mapId: vote.id, accept: true })}>Karte akzeptieren</Button>
    <Button variant="outline" disabled={busy} onClick={() => void send({ type: "map_vote", mapId: vote.id, accept: false })}>Karte ablehnen</Button>
  </>;
}

export function MapVotePanel({ game }: { game: CatanView }) {
  const vote = game.mapVote!; const { pending, accepted, rejected, tied } = mapVoteProgress(game);
  const host = game.players.find((p) => p.id === vote.hostPlayerId)!;
  const voted = Object.hasOwn(vote.votes, game.me!.id);
  return <section className="catan-map-vote" aria-label="Kartenabstimmung">
    <div role="status" aria-live="polite" aria-atomic="true">
      <strong>{accepted} Ja · {rejected} Nein · {pending.length} offen</strong>
      <p>{tied ? `Gleichstand: ${host.name} entscheidet als Spielleitung.` : voted ? `Du hast die Karte ${vote.votes[game.me!.id] ? "akzeptiert" : "abgelehnt"}. Wir warten auf ${pending.map((p) => p.name).join(", ")}.` : "Prüfe Felder, Zahlen und Häfen. Wir werten aus, sobald alle abgestimmt haben."}</p>
    </div>
    <details><summary>Stimmen ansehen</summary><ul>{[...game.players].sort((a, b) => a.color - b.color).map((p) => <li key={p.id}><span>{p.name}{p.id === vote.hostPlayerId ? " · Spielleitung" : ""}</span><strong>{Object.hasOwn(vote.votes, p.id) ? vote.votes[p.id] ? "Ja" : "Nein" : "Offen"}</strong></li>)}</ul></details>
  </section>;
}
