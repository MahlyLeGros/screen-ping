import fs from "fs";
import path from "path";

import store from "./store";
import { refreshAccessToken } from "./windows";

export interface FriendDto {
  id: string;
  user_id: string;
  username: string;
  avatar_url?: string | null;
  status: string;
  is_online: boolean;
  last_active_at?: string | null;
  direction: "incoming" | "outgoing" | "accepted" | "blocked";
}

export interface MeDto {
  id: string;
  username: string;
  is_desktop_online?: boolean;
}

export interface UploadResultDto {
  message_id: string;
  receiver_id: string;
  media_type: string;
  media_url: string;
  audio_url?: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;

export function setApiSessionExpiredHandler(handler: SessionExpiredHandler) {
  onSessionExpired = handler;
}

function baseUrl(): string {
  return store.get("serverUrl").replace(/\/+$/, "");
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string | { msg?: string }[] };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]?.msg) return body.detail[0].msg;
  } catch {
    /* ignore */
  }
  return res.statusText || `Request failed (${res.status})`;
}

async function apiFetch(pathname: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = store.get("accessToken");
  if (!token) {
    onSessionExpired?.();
    throw new ApiError("Not logged in", 401);
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl()}${pathname}`, { ...init, headers });

  if (res.status !== 401) return res;

  if (retried) {
    onSessionExpired?.();
    throw new ApiError("Session expired", 401);
  }

  const refreshed = await refreshAccessToken();
  if (!refreshed.ok) {
    if (refreshed.reason === "unauthorized") onSessionExpired?.();
    throw new ApiError("Session expired", 401);
  }

  return apiFetch(pathname, init, true);
}

async function apiJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(pathname, init);
  if (!res.ok) throw new ApiError(await parseError(res), res.status);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function listFriends(): Promise<FriendDto[]> {
  return apiJson("/api/friends");
}

export function requestFriend(username: string): Promise<FriendDto> {
  return apiJson("/api/friends/request", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export function acceptFriend(id: string): Promise<FriendDto> {
  return apiJson(`/api/friends/${id}/accept`, { method: "POST" });
}

export function declineFriend(id: string): Promise<{ ok: boolean }> {
  return apiJson(`/api/friends/${id}/decline`, { method: "POST" });
}

export function removeFriend(id: string): Promise<{ ok: boolean }> {
  return apiJson(`/api/friends/${id}/remove`, { method: "POST" });
}

export function blockFriend(id: string): Promise<{ ok: boolean }> {
  return apiJson(`/api/friends/${id}/block`, { method: "POST" });
}

export function unblockFriend(id: string): Promise<FriendDto> {
  return apiJson(`/api/friends/${id}/unblock`, { method: "POST" });
}

export function fetchMe(): Promise<MeDto> {
  return apiJson("/api/auth/me");
}

function fileBlob(filePath: string): { blob: Blob; name: string } {
  const buf = fs.readFileSync(filePath);
  return {
    blob: new Blob([new Uint8Array(buf)]),
    name: path.basename(filePath),
  };
}

export async function uploadMedia(
  receiverIds: string[],
  filePath: string,
  caption?: string,
  soundPath?: string,
): Promise<UploadResultDto[]> {
  if (receiverIds.length === 0) throw new ApiError("Select at least one friend");

  const url = new URL(`${baseUrl()}/api/media/upload`);
  url.searchParams.set("receiver_ids", receiverIds.join(","));
  if (caption?.trim()) url.searchParams.set("caption", caption.trim());

  const form = new FormData();
  const main = fileBlob(filePath);
  form.append("file", main.blob, main.name);
  if (soundPath) {
    const sound = fileBlob(soundPath);
    form.append("sound_file", sound.blob, sound.name);
  }

  const res = await apiFetch(url.pathname + url.search, { method: "POST", body: form });
  if (!res.ok) throw new ApiError(await parseError(res), res.status);
  const data = (await res.json()) as { uploads: UploadResultDto[] };
  return data.uploads;
}
