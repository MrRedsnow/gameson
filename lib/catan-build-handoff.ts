import { CONSTRUCTION_HANDOFF_MS } from "./catan-construction";
import { localActorId, type CatanGame } from "./catan";

export type BuildHandoff = { gameId: string; sequence: number; viewerId: string };
export type BuildHandoffEnvironment = {
  canAnimate: () => boolean;
  afterPaint: (callback: () => void) => () => void;
  delay: (callback: () => void, duration: number) => () => void;
  onInterruption: (callback: () => void) => () => void;
};

export function buildHandoffViewer(game: CatanGame, transition: BuildHandoff | null) {
  return transition?.gameId === game.id && transition.sequence === game.sequence
    ? transition.viewerId : localActorId(game);
}

/** Keep only the outgoing player's presentation alive; the saved game already advances. */
export class CatanBuildHandoff {
  private value: BuildHandoff | null = null;
  private listeners = new Set<() => void>();
  private cleanup: (() => void)[] = [];

  constructor(private onFinish: () => void) {}

  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start(value: BuildHandoff, environment: BuildHandoffEnvironment) {
    if (this.value || !environment.canAnimate()) return false;
    this.value = value;
    const finish = () => { if (this.value === value) this.finish(); };
    this.cleanup.push(environment.onInterruption(finish));
    this.cleanup.push(environment.afterPaint(() => {
      if (this.value === value) this.cleanup.push(environment.delay(finish, CONSTRUCTION_HANDOFF_MS));
    }));
    this.listeners.forEach((listener) => listener());
    return true;
  }

  finish = () => {
    if (!this.value) return;
    this.value = null;
    this.cleanup.splice(0).forEach((cleanup) => cleanup());
    this.onFinish();
    this.listeners.forEach((listener) => listener());
  };
}
