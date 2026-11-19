"use client";

import { Button } from "@/components/ui/button";
import type { Send } from "./play-primitives";

export function MapVoteActions({ mapId, resolvesTie, send, busy }: { mapId: string; resolvesTie: boolean; send: Send; busy: boolean }) {
  const type = resolvesTie ? "resolve_map_tie" : "map_vote";
  return <>
    <Button className="catan-primary" disabled={busy} onClick={() => void send({ type, mapId, accept: true })}>{resolvesTie ? "Karte annehmen" : "Karte akzeptieren"}</Button>
    <Button variant="outline" disabled={busy} onClick={() => void send({ type, mapId, accept: false })}>{resolvesTie ? "Neue Karte" : "Karte ablehnen"}</Button>
  </>;
}
