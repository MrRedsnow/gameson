import { env, waitUntil } from "cloudflare:workers";
import { ensureSchema, getD1 } from "../db";
import { readCatanLobby, type CatanLobby } from "./catan-lobby-server";

export type CatanLobbyPublication = { lobbyId: string; revision: number; lobby: CatanLobby | null };
export type CatanLiveNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
};

const namespace = () => (env as { CATAN_LIVE?: CatanLiveNamespace }).CATAN_LIVE;
const failure = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function upgradeCatanLive(request: Request, binding = namespace()) {
  const url = new URL(request.url);
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return failure("Eine WebSocket-Verbindung ist erforderlich.", 426);
  // The Ubuntu reverse proxy terminates HTTPS before forwarding to the Worker.
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (forwarded === "https" || forwarded === "http") url.protocol = `${forwarded}:`;
  if (request.headers.get("origin") !== url.origin) return failure("Diese Live-Verbindung ist nicht erlaubt.", 403);
  if (url.searchParams.has("token") || url.searchParams.has("authorization")) return failure("Zugangsdaten gehören nicht in die Adresse.", 400);
  const id = url.searchParams.get("lobby") ?? "";
  if (!/^[A-Z0-9]{6}$/.test(id)) return failure("Der Lobbycode fehlt oder ist ungültig.", 400);
  if (!binding) return failure("Die Live-Verbindung ist momentan nicht erreichbar.", 503);
  await ensureSchema();
  if (!await readCatanLobby(id, getD1())) return failure("Diese Lobby gibt es nicht mehr.", 404);
  return binding.get(binding.idFromName(id)).fetch(request);
}

async function publish(publication: CatanLobbyPublication) {
  const binding = namespace();
  if (!binding) throw new Error("CATAN_LIVE binding is unavailable");
  const response = await binding.get(binding.idFromName(publication.lobbyId)).fetch("https://catan-live.internal/publish", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(publication), signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error(`Catan live publish returned ${response.status}`);
}

/** A transport failure never changes the result of an already committed D1 action. */
export async function publishCatanLobby(lobby: CatanLobby | null, deleted?: { id: string; revision: number }) {
  if (!lobby && !deleted) return;
  const publication: CatanLobbyPublication = { lobbyId: lobby?.id ?? deleted!.id, revision: lobby?.revision ?? deleted!.revision, lobby };
  try { await publish(publication); }
  catch {
    console.warn("Catan live publication delayed", publication.lobbyId, publication.revision);
    const retry = async () => {
      for (const delay of [250, 1000]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        try { await publish(publication); return; } catch { /* The next attempt and HTTP reconciliation remain safe. */ }
      }
      console.warn("Catan live publication unavailable", publication.lobbyId, publication.revision);
    };
    try { waitUntil(retry()); } catch { /* No execution context: the committed response is still successful. */ }
  }
}
