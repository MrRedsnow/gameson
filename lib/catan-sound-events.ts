import { RESOURCES, type CatanView } from "./catan";
import { constructionBatch } from "./catan-construction";
import { resourceGainBatch } from "./catan-resource-gains";
import { RESOURCE_SOUNDS, type CatanSoundId } from "./catan-sounds";

/** Confirmed changes only: private receipts never produce another player's resource sounds. */
export function catanSoundEvents(previous: CatanView | null, current: CatanView): CatanSoundId[] {
  if (!previous?.me || !current.me || previous.id !== current.id || previous.me.id !== current.me.id || current.sequence <= previous.sequence) return [];
  const sounds = new Set<CatanSoundId>();
  const me = current.me.id;
  const notices = (current.notifications ?? []).filter((notice) => notice.id > previous.sequence && notice.id <= current.sequence && (notice.playerId === null || notice.playerId === me));
  const rolled = current.dice && (previous.turn !== current.turn || !previous.dice || current.dice.some((value, index) => value !== previous.dice![index]));
  if (rolled) {
    sounds.add("dice_roll");
    if (current.dice![0] + current.dice![1] === 7) sounds.add("robber_seven");
  }
  for (const event of constructionBatch(previous, current)?.events ?? []) {
    sounds.add(event.kind === "road" ? "build_road" : event.kind === "city" ? "build_city" : "build_settlement");
  }
  if (current.robberHex !== previous.robberHex || notices.some((notice) => notice.kind === "robber")) sounds.add("robber_move");
  if (current.trade?.toId === me && current.trade.id !== previous.trade?.id) sounds.add("trade_offer_received");
  for (const notice of notices) {
    if (notice.kind === "card") {
      if (notice.playerId === me && notice.tone === "gain") sounds.add("development_draw");
      else if (notice.playerId === null && notice.tone === "info" && notice.title !== "Siegpunktkarten aufgedeckt") sounds.add("development_play");
    }
    if (notice.kind === "resources" && notice.playerId === me) {
      if (["Handel", "Bankhandel", "Hafenhandel"].includes(notice.title)) sounds.add("trade_complete");
      if (notice.title === "Räuber · Diebstahl") sounds.add("resource_steal");
    }
  }
  // Compatible with older saved games without card notifications.
  if (current.me.development.length > previous.me.development.length) sounds.add("development_draw");
  if (!previous.playedDevelopment && current.playedDevelopment) sounds.add("development_play");
  if ((current.longestRoad && current.longestRoad !== previous.longestRoad) || (current.largestArmy && current.largestArmy !== previous.largestArmy)) sounds.add("special_award");
  const active = current.players[current.currentPlayer]?.id;
  const wasActive = previous.players[previous.currentPlayer]?.id;
  if (active === me && current.phase !== "finished" && (wasActive !== me || current.turn !== previous.turn || (previous.phase === "map_vote" && current.phase !== "map_vote"))) sounds.add("turn_start");
  if (current.winner && current.winner !== previous.winner) sounds.add("game_won");
  const gains = resourceGainBatch(previous, current)?.gains;
  for (const resource of RESOURCES) if (gains?.[resource]) sounds.add(RESOURCE_SOUNDS[resource]);
  return [...sounds];
}
