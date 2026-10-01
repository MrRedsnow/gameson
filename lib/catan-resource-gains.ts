import { RESOURCES, emptyResources, type CatanView, type Resource, type Resources } from "./catan";

export type ResourceGainStep = { id: string; resource: Resource; hexId: number | null };
export type ResourceGainBatch = { id: string; gains: Resources; steps: ResourceGainStep[] };

/** New receipts drive animations; opening a hand or reading old activity never replays them. */
export function resourceGainBatch(previous: CatanView | null, current: CatanView): ResourceGainBatch | null {
  if (!previous?.me || !current.me || previous.id !== current.id || previous.me.id !== current.me.id || current.sequence <= previous.sequence) return null;
  const id = `${current.id}:${current.me.id}:${previous.sequence}:${current.sequence}`;
  const gains = emptyResources();
  const steps: ResourceGainStep[] = [];
  const notices = (current.notifications ?? []).filter((notice) => notice.id > previous.sequence && notice.id <= current.sequence && notice.playerId === current.me!.id && notice.kind === "resources" && notice.tone === "gain" && notice.resources);
  for (const notice of notices) {
    for (const resource of RESOURCES) {
      const amount = notice.resources![resource] ?? 0;
      if (!Number.isSafeInteger(amount) || amount <= 0) continue;
      gains[resource] += amount;
      const origins: number[] = [];
      for (const origin of notice.resourceOrigins ?? []) {
        if (origin.resource !== resource || !Number.isSafeInteger(origin.hexId) || !Number.isSafeInteger(origin.amount) || origin.amount <= 0) continue;
        if (!current.board.hexes.some((hex) => hex.id === origin.hexId && hex.resource === resource)) continue;
        const contribution = Math.min(origin.amount, amount - origins.length);
        for (let index = 0; index < contribution; index++) origins.push(origin.hexId);
      }
      for (let index = 0; index < amount; index++) steps.push({ id: `${id}:notice:${notice.id}:${resource}:${index}`, resource, hexId: origins[index] ?? null });
    }
  }
  // Older snapshots may have no receipts. Their confirmed positive difference still counts.
  for (const resource of RESOURCES) {
    if (gains[resource]) continue;
    const amount = current.me.resources[resource] - previous.me.resources[resource];
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    gains[resource] = amount;
    for (let index = 0; index < amount; index++) steps.push({ id: `${id}:difference:${resource}:${index}`, resource, hexId: null });
  }
  return steps.length ? { id, gains, steps } : null;
}
