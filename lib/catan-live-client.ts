import type { CatanLobbyState, CatanLiveServerMessage } from "./catan-live";
import type { GameSession } from "./game-session";

const POLL_MS = 2500;
const RECONCILE_MS = 60000;
const REQUEST_TIMEOUT_MS = 15000;
const PING_MS = 30000;
const SOCKET_TIMEOUT_MS = 10000;
const RECONNECT_MS = [1000, 2000, 4000, 8000, 15000];

type Timer = ReturnType<typeof setTimeout>;
type LiveSocket = Pick<WebSocket, "readyState" | "send" | "close" | "addEventListener" | "removeEventListener">;
type HttpResponse = Pick<Response, "ok" | "status" | "json">;

export type CatanLiveCallbacks = {
  initialState?: CatanLobbyState | null;
  onState: (state: CatanLobbyState, metadata: { baseline: boolean }) => void;
  onConnection: (connected: boolean) => void;
  onRevoked: (status: 401 | 404, message: string) => void;
};

/** Browser boundaries are injectable so reconnects and stale responses are tested with a real controller. */
export type CatanLiveEnvironment = {
  origin: string;
  createSocket: (url: string) => LiveSocket | null;
  fetch: (url: string, options: RequestInit) => Promise<HttpResponse>;
  setTimeout: (callback: () => void, delay: number) => Timer;
  clearTimeout: (timer: Timer) => void;
  random: () => number;
  subscribeWake?: (callback: () => void) => () => void;
};

export type CatanLiveConnection = {
  refresh: (options?: { baseline?: boolean }) => Promise<void>;
  dispose: () => void;
};

function browserEnvironment(): CatanLiveEnvironment {
  return {
    origin: window.location.origin,
    createSocket: (url) => typeof WebSocket === "function" ? new WebSocket(url) : null,
    fetch: (url, options) => fetch(url, options),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
    random: Math.random,
    subscribeWake(callback) {
      const visible = () => { if (!document.hidden) callback(); };
      window.addEventListener("online", callback);
      document.addEventListener("visibilitychange", visible);
      return () => {
        window.removeEventListener("online", callback);
        document.removeEventListener("visibilitychange", visible);
      };
    },
  };
}

export function startCatanLive(session: Pick<GameSession, "lobbyId" | "token">, callbacks: CatanLiveCallbacks, environment?: CatanLiveEnvironment): CatanLiveConnection {
  const env = environment ?? browserEnvironment();
  const url = new URL("/api/catan/live", env.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("lobby", session.lobbyId);
  const httpUrl = `/api/catan?lobby=${encodeURIComponent(session.lobbyId)}`;
  let stopped = false;
  let socket: LiveSocket | null = null;
  let removeSocketListeners: (() => void) | null = null;
  let pollTimer: Timer | undefined;
  let reconnectTimer: Timer | undefined;
  let handshakeTimer: Timer | undefined;
  let pingTimer: Timer | undefined;
  let pongTimer: Timer | undefined;
  let removeWakeListener: (() => void) | undefined;
  let reconnectAttempt = 0;
  let httpHealthy = false;
  let pushHealthy = false;
  let reportedConnection: boolean | undefined;
  let revision = callbacks.initialState?.lobby.id === session.lobbyId ? callbacks.initialState.lobby.revision : -1;
  let pending: { controller: AbortController; baseline: boolean; timer?: Timer; cancel: () => void; promise: Promise<void> } | null = null;

  const clear = (timer: Timer | undefined) => { if (timer !== undefined) env.clearTimeout(timer); };
  const reportConnection = () => {
    const connected = httpHealthy || pushHealthy;
    if (!stopped && reportedConnection !== connected) {
      reportedConnection = connected;
      callbacks.onConnection(connected);
    }
  };
  function validState(value: unknown): value is CatanLobbyState {
    if (!value || typeof value !== "object") return false;
    const state = value as CatanLobbyState;
    return state.lobby?.id === session.lobbyId && Number.isSafeInteger(state.lobby.revision) && state.lobby.revision >= 0
      && typeof state.me?.id === "string" && Array.isArray(state.members) && (state.game === null || typeof state.game === "object");
  }
  const accept = (state: CatanLobbyState, baseline: boolean) => {
    if (stopped || state.lobby.revision <= revision) return;
    revision = state.lobby.revision;
    callbacks.onState(state, { baseline });
  };
  const closeSocket = () => {
    clear(handshakeTimer); clear(pingTimer); clear(pongTimer);
    handshakeTimer = pingTimer = pongTimer = undefined;
    removeSocketListeners?.(); removeSocketListeners = null;
    const current = socket; socket = null;
    try { current?.close(); } catch { /* A failed socket is already unusable. */ }
    pushHealthy = false;
  };
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    clear(pollTimer); clear(reconnectTimer); pollTimer = reconnectTimer = undefined;
    if (pending) { clear(pending.timer); pending.controller.abort(); pending.cancel(); }
    removeWakeListener?.(); removeWakeListener = undefined;
    closeSocket();
  };
  const revoke = (status: 401 | 404, message: string) => {
    if (stopped) return;
    httpHealthy = pushHealthy = false; reportConnection();
    dispose();
    callbacks.onRevoked(status, message);
  };
  const schedulePoll = () => {
    clear(pollTimer); pollTimer = undefined;
    if (!stopped && !pending) pollTimer = env.setTimeout(() => { pollTimer = undefined; void refresh(); }, pushHealthy ? RECONCILE_MS : POLL_MS);
  };

  function refresh({ baseline = false }: { baseline?: boolean } = {}): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pending) { pending.baseline ||= baseline; return pending.promise; }
    clear(pollTimer); pollTimer = undefined;
    const request = { controller: new AbortController(), baseline: baseline || revision < 0, timer: undefined as Timer | undefined, cancel: () => {}, promise: Promise.resolve() };
    pending = request;
    request.promise = (async () => {
      try {
        const timeout = new Promise<never>((_, reject) => {
          request.cancel = () => reject(new Error("Die Anfrage wurde beendet."));
          request.timer = env.setTimeout(() => { request.controller.abort(); reject(new Error("Die Anfrage hat zu lange gedauert.")); }, REQUEST_TIMEOUT_MS);
        });
        const response = await Promise.race([
          env.fetch(httpUrl, { cache: "no-store", signal: request.controller.signal, headers: { Authorization: `Bearer ${session.token}` } })
            .then(async (result) => ({ result, data: await result.json().catch(() => undefined) as unknown })),
          timeout,
        ]);
        if (stopped || pending !== request) return;
        if (response.result.status === 401 || response.result.status === 404) {
          const data = response.data as { error?: unknown } | undefined;
          revoke(response.result.status, typeof data?.error === "string" ? data.error : "Bitte tritt der Lobby erneut bei.");
        } else if (response.result.ok && validState(response.data)) {
          httpHealthy = true; reportConnection(); accept(response.data, request.baseline);
        } else { httpHealthy = false; reportConnection(); }
      } catch {
        if (!stopped && pending === request) { httpHealthy = false; reportConnection(); }
      } finally {
        clear(request.timer);
        if (pending === request) pending = null;
        schedulePoll();
      }
    })();
    return request.promise;
  }

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== undefined) return;
    const delay = RECONNECT_MS[Math.min(reconnectAttempt++, RECONNECT_MS.length - 1)];
    const jitter = Math.min(15000, Math.round(delay * (.8 + .4 * env.random())));
    reconnectTimer = env.setTimeout(() => { reconnectTimer = undefined; connect(); }, jitter);
  };
  const lostSocket = (current: LiveSocket) => {
    if (stopped || socket !== current) return;
    closeSocket(); reportConnection();
    void refresh();
    scheduleReconnect();
  };
  const schedulePing = (current: LiveSocket) => {
    clear(pingTimer);
    pingTimer = env.setTimeout(() => {
      pingTimer = undefined;
      if (stopped || socket !== current || !pushHealthy) return;
      try {
        current.send(JSON.stringify({ type: "ping" }));
        pongTimer = env.setTimeout(() => { pongTimer = undefined; lostSocket(current); }, SOCKET_TIMEOUT_MS);
      } catch { lostSocket(current); }
    }, PING_MS);
  };
  function connect() {
    if (stopped || socket) return;
    let current: LiveSocket | null;
    try { current = env.createSocket(url.toString()); } catch { current = null; }
    if (!current) { scheduleReconnect(); return; }
    socket = current;
    const open = () => {
      if (stopped || socket !== current) return;
      clear(handshakeTimer);
      handshakeTimer = env.setTimeout(() => lostSocket(current), SOCKET_TIMEOUT_MS);
      try { current.send(JSON.stringify({ type: "authenticate", token: session.token })); }
      catch { lostSocket(current); return; }
      void refresh({ baseline: true });
    };
    const message = (event: MessageEvent) => {
      if (stopped || socket !== current || typeof event.data !== "string") return;
      let data: CatanLiveServerMessage;
      try { data = JSON.parse(event.data) as CatanLiveServerMessage; } catch { return; }
      if (!data || typeof data !== "object") return;
      if (data.type === "revoked" && (data.status === 401 || data.status === 404)) {
        revoke(data.status, typeof data.message === "string" ? data.message : "Bitte tritt der Lobby erneut bei.");
      } else if ((data.type === "hello" || data.type === "state") && validState(data.state)) {
        if (data.type === "state" && !pushHealthy) return;
        if (data.type === "hello") {
          clear(handshakeTimer); handshakeTimer = undefined;
          pushHealthy = true; reconnectAttempt = 0; schedulePing(current); schedulePoll();
        }
        reportConnection(); accept(data.state, data.type === "hello");
      } else if (data.type === "pong" && pushHealthy && pongTimer !== undefined) {
        clear(pongTimer); pongTimer = undefined; schedulePing(current);
      }
    };
    const close = () => lostSocket(current);
    current.addEventListener("open", open); current.addEventListener("message", message);
    current.addEventListener("close", close); current.addEventListener("error", close);
    removeSocketListeners = () => {
      current.removeEventListener("open", open); current.removeEventListener("message", message);
      current.removeEventListener("close", close); current.removeEventListener("error", close);
    };
    handshakeTimer = env.setTimeout(() => lostSocket(current), SOCKET_TIMEOUT_MS);
  }

  removeWakeListener = env.subscribeWake?.(() => {
    if (stopped) return;
    void refresh({ baseline: true });
    if (!socket) { clear(reconnectTimer); reconnectTimer = undefined; connect(); }
  });
  void refresh({ baseline: true });
  connect();
  return { refresh, dispose };
}
