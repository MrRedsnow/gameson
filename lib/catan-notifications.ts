import { RESOURCES, emptyResources, type CatanNotification, type CatanView } from "./catan";

export type CatanActivity = { id: number; title: string; message: string; gains: ReturnType<typeof emptyResources>; losses: ReturnType<typeof emptyResources> };

/** Merge the payment and receipt of one action; never include another player's private hand. */
export function groupedActivity(game: Pick<CatanView, "notifications" | "me">, afterSequence = -1): CatanActivity[] {
  const groups = new Map<string, CatanActivity>();
  let previous: CatanNotification | undefined;
  let legacyKey = "";
  for (const notice of game.notifications ?? []) {
    if (notice.id <= afterSequence || (notice.playerId !== null && notice.playerId !== game.me?.id)) continue;
    if (notice.actionId === undefined && !(previous && previous.id + 1 === notice.id && previous.kind === "resources" && notice.kind === "resources" && previous.tone === "loss" && notice.tone === "gain" && previous.title === notice.title && previous.message === notice.message)) legacyKey = `legacy:${notice.id}`;
    const key = notice.actionId === undefined ? legacyKey : `${notice.actionId}:${notice.kind === "resources" ? "resources" : notice.title}`;
    const group = groups.get(key) ?? { id: notice.id, title: notice.title, message: notice.message, gains: emptyResources(), losses: emptyResources() };
    group.id = notice.id;
    if (notice.resources) for (const r of RESOURCES) (notice.tone === "loss" ? group.losses : group.gains)[r] += notice.resources[r];
    groups.set(key, group); previous = notice;
  }
  return [...groups.values()];
}

/** Older saved games queued receipt-only turns. Keep their unread markers, not those turns. */
export function restoreLocalSeen(game: { players: { id: string }[]; sequence: number }, seen?: Record<string, number>, receipts: { playerId: string; afterSequence: number }[] = []) {
  return Object.fromEntries(game.players.map((p) => [p.id, Math.max(0, Math.min(game.sequence, seen?.[p.id] ?? receipts.find((r) => r.playerId === p.id)?.afterSequence ?? game.sequence))]));
}
