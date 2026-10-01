import { authenticateCatanToken, catanLobbyMembers, catanLobbyView, readCatanLobby, type CatanLobby, type CatanLobbyDatabase } from "../lib/catan-lobby-server";
import type { CatanLiveServerMessage } from "../lib/catan-live";
import type { CatanLobbyPublication } from "../lib/catan-live-server";

type LiveSocket = WebSocket & { serializeAttachment(value: unknown): void; deserializeAttachment(): Attachment | null };
type Attachment = { lobbyId: string; deadline: number; revision: number; memberId?: string; tokenHash?: string };
type LiveContext = {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): LiveSocket[];
  setWebSocketAutoResponse(pair: unknown): void;
  storage: { getAlarm(): Promise<number | null>; setAlarm(time: number): Promise<void> };
};
type LiveEnv = { DB: CatanLobbyDatabase };
const AUTH_TIMEOUT_MS = 10000;

/** Public changes are broadcast through one hibernating object per lobby. D1 owns all mutations. */
export class CatanLobbyLive {
  private queue: Promise<void> = Promise.resolve();
  private latest: CatanLobby | null = null;
  private revision = 0;
  private lobbyId: string | null = null;

  constructor(private ctx: LiveContext, private env: LiveEnv) {
    for (const socket of ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment) { this.lobbyId ??= attachment.lobbyId; this.revision = Math.max(this.revision, attachment.revision); }
    }
    // These exact messages do not wake a hibernating object or expose any game data.
    const { WebSocketRequestResponsePair } = globalThis as unknown as { WebSocketRequestResponsePair: new (request: string, response: string) => unknown };
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private send(socket: LiveSocket, message: CatanLiveServerMessage) {
    try { socket.send(JSON.stringify(message)); return true; }
    catch { try { socket.close(1011, "Live-Verbindung unterbrochen"); } catch { /* Already closed. */ } return false; }
  }

  private revoke(socket: LiveSocket, status: 401 | 404) {
    this.send(socket, { type: "revoked", status, message: status === 404 ? "Diese Lobby gibt es nicht mehr." : "Bitte tritt der Lobby erneut bei." });
    try { socket.close(1008, status === 404 ? "Lobby beendet" : "Zugang nicht mehr gültig"); } catch { /* Already closed. */ }
  }

  private broadcast(lobby: CatanLobby | null) {
    const members = lobby ? catanLobbyMembers(lobby) : [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (!attachment?.memberId) continue;
      if (!lobby) { this.revoke(socket, 404); continue; }
      const member = members.find((member) => member.id === attachment.memberId && member.tokenHash === attachment.tokenHash);
      if (!member) { this.revoke(socket, 401); continue; }
      if (lobby.revision <= attachment.revision) continue;
      if (this.send(socket, { type: "state", state: catanLobbyView(lobby, member) })) socket.serializeAttachment({ ...attachment, revision: lobby.revision });
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") {
      const publication = await request.json() as CatanLobbyPublication;
      return this.serial(async () => {
        if (!Number.isSafeInteger(publication.revision) || publication.revision < 1 || !/^[A-Z0-9]{6}$/.test(publication.lobbyId) ||
          (publication.lobby && (publication.lobby.id !== publication.lobbyId || publication.lobby.revision !== publication.revision)) ||
          (this.lobbyId && this.lobbyId !== publication.lobbyId)) return new Response("Invalid publication", { status: 400 });
        this.lobbyId = publication.lobbyId;
        if (publication.revision <= this.revision) return new Response(null, { status: 204 });
        this.latest = publication.lobby; this.revision = publication.revision;
        this.broadcast(publication.lobby);
        return new Response(null, { status: 204 });
      });
    }
    if (url.pathname !== "/api/catan/live" || request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Not found", { status: 404 });
    return this.serial(async () => {
      const id = url.searchParams.get("lobby") ?? "";
      if (!/^[A-Z0-9]{6}$/.test(id) || (this.lobbyId && this.lobbyId !== id)) return new Response("Invalid lobby", { status: 400 });
      if (this.ctx.getWebSockets().length >= 32) return new Response("Too many connections", { status: 429 });
      this.lobbyId = id;
      const { WebSocketPair } = globalThis as unknown as { WebSocketPair: new () => { 0: LiveSocket; 1: LiveSocket } };
      const pair = new WebSocketPair();
      const deadline = Date.now() + AUTH_TIMEOUT_MS;
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ lobbyId: id, deadline, revision: 0 } satisfies Attachment);
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > deadline) await this.ctx.storage.setAlarm(deadline);
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit & { webSocket: WebSocket });
    });
  }

  async webSocketMessage(socket: LiveSocket, message: string | ArrayBuffer) {
    return this.serial(async () => {
      if (typeof message !== "string" || message.length > 512) { this.revoke(socket, 401); return; }
      let parsed: { type?: unknown; token?: unknown };
      try { parsed = JSON.parse(message); if (!parsed || typeof parsed !== "object") throw new Error("Invalid message"); }
      catch { this.revoke(socket, 401); return; }
      const attachment = socket.deserializeAttachment();
      if (!attachment) { this.revoke(socket, 401); return; }
      if (attachment.memberId) {
        if (parsed.type === "ping") this.send(socket, { type: "pong" });
        else { try { socket.close(1008, "Ungültige Live-Nachricht"); } catch { /* Already closed. */ } }
        return;
      }
      if (Date.now() >= attachment.deadline || parsed.type !== "authenticate" || typeof parsed.token !== "string") { this.revoke(socket, 401); return; }
      const current = await readCatanLobby(attachment.lobbyId, this.env.DB);
      if (!current) { this.revoke(socket, 404); return; }
      // A publication may already be newer than a read initiated elsewhere.
      const lobby = this.latest && this.latest.revision > current.revision ? this.latest : current;
      const member = await authenticateCatanToken(parsed.token, lobby);
      if (!member) { this.revoke(socket, 401); return; }
      if (lobby.revision > this.revision) { this.revision = lobby.revision; this.latest = lobby; this.broadcast(lobby); }
      else this.latest ??= lobby;
      const authenticated = { ...attachment, memberId: member.id, tokenHash: member.tokenHash, revision: lobby.revision };
      socket.serializeAttachment(authenticated);
      this.send(socket, { type: "hello", state: catanLobbyView(lobby, member) });
    });
  }

  async alarm() {
    let next: number | null = null;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (!attachment || attachment.memberId) continue;
      if (attachment.deadline <= Date.now()) this.revoke(socket, 401);
      else next = Math.min(next ?? attachment.deadline, attachment.deadline);
    }
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  webSocketClose(socket: LiveSocket, code: number, reason: string) {
    try { socket.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* Already closed. */ }
  }
  webSocketError(socket: LiveSocket) { try { socket.close(1011, "Live-Verbindung unterbrochen"); } catch { /* Already closed. */ } }
}
