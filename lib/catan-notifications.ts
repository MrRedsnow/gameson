import { RESOURCES, emptyResources, type CatanNotification, type CatanView, type Resource } from "./catan";

export type NotificationQueue = {
  player: string; sequence: number; notices: CatanNotification[]; collected: Resource[]; arrivals: number;
};

export function createNotificationQueue(game: CatanView, afterSequence = game.sequence): NotificationQueue {
  return {
    player: `${game.id}:${game.me!.id}`, sequence: game.sequence,
    notices: (game.notifications ?? []).filter((notice) => notice.id > afterSequence), collected: [], arrivals: 0,
  };
}

export function updateNotificationQueue(current: NotificationQueue, game: CatanView): NotificationQueue {
  if (current.player !== `${game.id}:${game.me!.id}`) return createNotificationQueue(game);
  if (game.sequence <= current.sequence) return current;
  return { ...current, sequence: game.sequence, notices: [...current.notices, ...(game.notifications ?? []).filter((notice) => notice.id > current.sequence)] };
}

export function collectNotification(current: NotificationQueue, id: number, resource?: Resource): NotificationQueue {
  if (current.notices[0]?.id !== id) return current;
  if (!resource) return { ...current, notices: current.notices.slice(1), collected: [] };
  if (current.collected.includes(resource)) return current;
  return { ...current, collected: [...current.collected, resource], arrivals: current.arrivals + 1 };
}

/** Only delay the visible hand; rules and saved state always use the confirmed hand. */
export function presentedResources(game: CatanView, queue: NotificationQueue) {
  const pending = emptyResources();
  queue.notices.forEach((notice, index) => {
    if (notice.kind !== "resources" || notice.tone !== "gain" || !notice.resources) return;
    for (const r of RESOURCES) if (index !== 0 || !queue.collected.includes(r)) pending[r] += notice.resources[r];
  });
  const resources = emptyResources();
  for (const r of RESOURCES) resources[r] = Math.max(0, game.me!.resources[r] - pending[r]);
  return resources;
}

/** Everyone affected gets a private turn to read their receipt on a shared device. */
export function localNotificationRecipients(game: { players: { id: string }[]; notifications?: CatanNotification[] }, actorId: string, afterSequence: number) {
  const notices = (game.notifications ?? []).filter((notice) => notice.id > afterSequence);
  return [actorId, ...game.players.map((p) => p.id).filter((id) => id !== actorId)]
    .filter((id) => notices.some((notice) => notice.playerId === null || notice.playerId === id));
}
