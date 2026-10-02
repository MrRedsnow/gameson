import { DEVELOPMENT_INFO, type CatanView, type Development } from "./catan";

export type CatanRollPresentation = { id: string; turn: number; dice: [number, number]; robberHex: number };
export type CatanRobberPresentation = { id: string; fromHex: number; toHex: number };
export type CatanAwardPresentation = { id: string; type: "longestRoad" | "largestArmy"; fromId: string | null; toId: string | null };
export type CatanCardPresentation = { id: string; cardId: string; type: Development; playerId: string };
export type CatanPresentationBatch = {
  id: string; roll: CatanRollPresentation | null; robber: CatanRobberPresentation | null;
  awards: CatanAwardPresentation[]; cards: CatanCardPresentation[];
};

/** Only fresh confirmed receipts; coalesced updates present the latest relevant event. */
export function catanPresentationBatch(previous: CatanView | null, current: CatanView): CatanPresentationBatch | null {
  if (!previous || previous.id !== current.id || previous.me?.id !== current.me?.id || current.sequence <= previous.sequence || current.phase === "map_vote") return null;
  const id = `${current.id}:${previous.sequence}:${current.sequence}`;
  const notices = (current.notifications ?? []).filter((notice) => notice.id > previous.sequence && notice.id <= current.sequence && (notice.playerId === null || notice.playerId === current.me?.id)).sort((a, b) => a.id - b.id);
  const hasHex = (hexId: number) => Number.isSafeInteger(hexId) && current.board.hexes.some((hex) => hex.id === hexId);
  const hasPlayer = (playerId: string | null) => playerId === null || current.players.some((player) => player.id === playerId);
  let roll: CatanRollPresentation | null = null;
  const rollNotice = notices.findLast((notice) => notice.playerId === null && notice.kind === "roll" && notice.roll?.turn === current.turn && notice.roll.dice.every((value) => Number.isInteger(value) && value >= 1 && value <= 6) && hasHex(notice.roll.robberHex));
  if (rollNotice?.roll && current.dice && current.dice.every((value, index) => value === rollNotice.roll!.dice[index])) roll = { id: `${current.id}:roll:${rollNotice.id}`, ...rollNotice.roll };
  else if (current.dice && (previous.turn !== current.turn || !previous.dice || current.dice.some((value, index) => value !== previous.dice![index]))) roll = { id: `${id}:roll`, turn: current.turn, dice: [...current.dice], robberHex: previous.robberHex };

  let robber: CatanRobberPresentation | null = null;
  const robberNotice = notices.findLast((notice) => notice.playerId === null && notice.kind === "robber" && notice.robber && notice.robber.toHex === current.robberHex && notice.robber.fromHex !== notice.robber.toHex && hasHex(notice.robber.fromHex) && hasHex(notice.robber.toHex));
  if (robberNotice?.robber) robber = { id: `${current.id}:robber:${robberNotice.id}`, ...robberNotice.robber };
  else if (previous.robberHex !== current.robberHex && hasHex(previous.robberHex) && hasHex(current.robberHex)) robber = { id: `${id}:robber`, fromHex: previous.robberHex, toHex: current.robberHex };

  const awards: CatanAwardPresentation[] = [];
  for (const type of ["longestRoad", "largestArmy"] as const) {
    const notice = notices.findLast((item) => item.playerId === null && item.kind === "award" && item.award?.type === type && item.award.toId === current[type] && item.award.fromId !== item.award.toId && hasPlayer(item.award.fromId) && hasPlayer(item.award.toId));
    if (notice?.award) awards.push({ id: `${current.id}:award:${notice.id}`, ...notice.award });
    else if (previous[type] !== current[type] && hasPlayer(previous[type]) && hasPlayer(current[type])) awards.push({ id: `${id}:${type}`, type, fromId: previous[type], toId: current[type] });
  }

  const cards: CatanCardPresentation[] = [];
  const me = current.me;
  if (me) {
    const notice = notices.findLast((item) => item.playerId === me.id && item.kind === "card" && item.tone === "gain" && item.card && Object.hasOwn(DEVELOPMENT_INFO, item.card.type) && me.development.some((card) => card.id === item.card!.id && card.type === item.card!.type));
    if (notice?.card) cards.push({ id: `${current.id}:card:${notice.id}`, cardId: notice.card.id, type: notice.card.type, playerId: me.id });
    else {
      const oldIds = new Set(previous.me?.development.map((card) => card.id));
      const card = me.development.findLast((item) => !oldIds.has(item.id) && Object.hasOwn(DEVELOPMENT_INFO, item.type));
      if (card) cards.push({ id: `${id}:card:${card.id}`, cardId: card.id, type: card.type, playerId: me.id });
    }
  }
  return roll || robber || awards.length || cards.length ? { id, roll, robber, awards, cards } : null;
}

/** Hidden updates are consumed by callers too; old snapshots never lower this cursor. */
export class CatanPresentationCursor {
  private seen: CatanView;
  private baseline: number;
  constructor(initial: CatanView, baseline = 0) { this.seen = initial; this.baseline = baseline; }
  update(game: CatanView, baseline = 0): CatanPresentationBatch | null {
    if (game.id !== this.seen.id || game.me?.id !== this.seen.me?.id || baseline !== this.baseline) {
      this.seen = game; this.baseline = baseline; return null;
    }
    if (game.sequence <= this.seen.sequence) return null;
    const batch = catanPresentationBatch(this.seen, game);
    this.seen = game;
    return batch;
  }
}
