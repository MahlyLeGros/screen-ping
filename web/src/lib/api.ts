import type { MediaLayout } from "../../../shared/types";

const API_BASE = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");

/** Build API URL without double slashes (e.g. base ending with /). */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE) return `${API_BASE}${normalized}`;
  return new URL(normalized, window.location.origin).toString();
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url?: string | null;
  terms_accepted_at?: string | null;
  terms_accepted_version?: string | null;
  current_terms_version?: string | null;
  needs_terms_acceptance?: boolean;
  is_desktop_online?: boolean;
  desktop_version?: string | null;
}

export interface Friend {
  id: string;
  user_id: string;
  username: string;
  avatar_url?: string | null;
  status: string;
  is_online: boolean;
  last_active_at?: string | null;
  direction: "incoming" | "outgoing" | "accepted" | "blocked";
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string | null;
}

export interface GoogleAuthResponse {
  access_token?: string | null;
  refresh_token?: string | null;
  needs_username?: boolean;
  suggested_username?: string | null;
  email?: string | null;
}

export interface HistoryLayerItem {
  url: string;
  name: string;
  mime?: string | null;
  layout: MediaLayout;
  opacity: number;
  zIndex: number;
}

export interface MessageHistoryItem {
  id: string;
  receiver_username: string;
  media_type: string;
  media_url: string;
  audio_url?: string | null;
  caption?: string | null;
  delivery_status: string;
  created_at: string;
  layers?: HistoryLayerItem[] | null;
}

const FETCH_CREDENTIALS: RequestCredentials = "include";

let accessToken: string | null = null;
let rememberSession = true;
let bootstrapPromise: Promise<boolean> | null = null;

function clearLegacyTokenStorage() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("refresh_token");
}

clearLegacyTokenStorage();

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("X-Auth-Persist", rememberSession ? "1" : "0");
  return headers;
}

export function getTokens() {
  return { access: accessToken, refresh: null as string | null };
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function establishSession(access: string, remember = true) {
  accessToken = access;
  rememberSession = remember;
  bootstrapPromise = Promise.resolve(true);
  clearLegacyTokenStorage();
}

/** @deprecated Use establishSession — refresh is stored in an HttpOnly cookie. */
export function setTokens(access: string, _refresh?: string | null, persist = true) {
  establishSession(access, persist);
}

export function clearTokens() {
  accessToken = null;
  bootstrapPromise = null;
  clearLegacyTokenStorage();
}

export async function logoutSession() {
  try {
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      credentials: FETCH_CREDENTIALS,
    });
  } catch {
    /* ignore network errors during logout */
  }
  clearTokens();
}

export function notifyAuthExpired() {
  void logoutSession();
  window.dispatchEvent(new Event("auth:expired"));
}

export async function ensureAuthBootstrapped(): Promise<boolean> {
  if (accessToken) return true;
  if (!bootstrapPromise) {
    bootstrapPromise = refreshAccessToken().then((token) => token !== null);
  }
  return bootstrapPromise;
}

export class AuthError extends Error {
  constructor(message = "Session expired — please log in again") {
    super(message);
    this.name = "AuthError";
  }
}

function decodeJwtExp(token: string): number | null {
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).exp ?? null;
  } catch {
    return null;
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(apiUrl("/api/auth/refresh"), {
    method: "POST",
    credentials: FETCH_CREDENTIALS,
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) {
    clearTokens();
    bootstrapPromise = null;
    return null;
  }
  const data: TokenResponse = await res.json();
  accessToken = data.access_token;
  return data.access_token;
}

/** Return a valid access token, refreshing if expired or about to expire. */
export async function getValidAccessToken(): Promise<string | null> {
  if (!accessToken) return refreshAccessToken();
  const exp = decodeJwtExp(accessToken);
  if (exp && exp * 1000 > Date.now() + 60_000) {
    return accessToken;
  }
  return refreshAccessToken();
}

export interface VerificationResponse {
  ok: boolean;
  message: string;
  dev_code?: string | null;
  email?: string | null;
  username?: string | null;
  needs_verification?: boolean;
}

export class ApiError extends Error {
  code?: string;
  email?: string;

  constructor(message: string, extra?: { code?: string; email?: string }) {
    super(message);
    this.name = "ApiError";
    this.code = extra?.code;
    this.email = extra?.email;
  }
}

function normalizeErrorDetail(detail: unknown, fallback = "Request failed"): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const joined = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          if (typeof record.msg === "string") return record.msg;
          if (Array.isArray(record.loc)) return `${record.loc.join(".")}: ${record.msg ?? "invalid"}`;
        }
        return "";
      })
      .filter(Boolean)
      .join(" | ");
    return joined || fallback;
  }
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.msg === "string") return record.msg;
  }
  return fallback;
}

async function publicRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = authHeaders(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(apiUrl(path), { ...options, headers, credentials: FETCH_CREDENTIALS });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = err.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const record = detail as Record<string, unknown>;
      throw new ApiError(typeof record.message === "string" ? record.message : res.statusText || "Request failed", {
        code: typeof record.code === "string" ? record.code : undefined,
        email: typeof record.email === "string" ? record.email : undefined,
      });
    }
    throw new Error(normalizeErrorDetail(detail, res.statusText || "Request failed"));
  }
  return res.json();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getValidAccessToken();
  const headers = authHeaders(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  let res = await fetch(apiUrl(path), { ...options, headers, credentials: FETCH_CREDENTIALS });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      res = await fetch(apiUrl(path), { ...options, headers, credentials: FETCH_CREDENTIALS });
    } else {
      notifyAuthExpired();
      throw new AuthError();
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(normalizeErrorDetail(err.detail, res.statusText || "Request failed"));
  }
  return res.json();
}

export interface UploadResult {
  message_id: string;
  receiver_id: string;
  media_type: string;
  media_url: string;
  audio_url?: string;
}

export interface LayerUploadInput {
  file: File;
  layout: MediaLayout;
  opacity: number;
  zIndex: number;
}

function buildUploadForm(file: File, soundFile?: File) {
  const form = new FormData();
  form.append("file", file, file.name);
  if (soundFile) form.append("sound_file", soundFile, soundFile.name);
  return form;
}

const EXT_MIME_FALLBACK: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  // Prefer video/webm for Send main files; pure audio WebM is rare and sniffed server-side.
  webm: "video/webm",
  mp4: "video/mp4",
  mov: "video/mp4",
};

export function normalizeUploadFile(file: File): File {
  if (file.type && file.type !== "application/octet-stream") return file;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = EXT_MIME_FALLBACK[ext];
  if (!mime) return file;
  return new File([file], file.name, { type: mime, lastModified: file.lastModified });
}

async function uploadWithAuth(url: URL, file: File, soundFile?: File): Promise<Response> {
  async function doUpload(token: string) {
    return fetch(url.toString(), {
      method: "POST",
      credentials: FETCH_CREDENTIALS,
      headers: { Authorization: `Bearer ${token}` },
      body: buildUploadForm(file, soundFile),
    });
  }

  let token = await getValidAccessToken();
  if (!token) throw new Error("Not logged in — please log in again");

  let res = await doUpload(token);
  if (res.status === 401) {
    token = await refreshAccessToken();
    if (!token) throw new Error("Session expired — please log in again");
    res = await doUpload(token);
  }
  return res;
}

async function parseUploadError(res: Response): Promise<never> {
  if (res.status === 413) {
    let detail = "File too large";
    try {
      const err = await res.json();
      if (typeof err.detail === "string") detail = err.detail;
    } catch {
      detail =
        "Upload blocked by server (max ~25MB images, 50MB video). If this happens for small files, nginx needs client_max_body_size 60M — see deploy/nginx-screenping.conf";
    }
    throw new Error(detail);
  }
  const err = await res.json().catch(() => ({ detail: res.statusText }));
  throw new Error(err.detail || "Upload failed");
}

export const api = {
  authProviders: () => publicRequest<{ google_client_id: string | null }>("/api/auth/providers"),
  googleAuth: (credential: string, username?: string, acceptTerms?: boolean, rememberMe = true) =>
    publicRequest<GoogleAuthResponse>("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({
        credential,
        username: username || undefined,
        accept_terms: Boolean(acceptTerms),
        remember_me: rememberMe,
      }),
    }),
  approveDesktopLink: (pairingId: string) =>
    request<{ ok: boolean; message: string }>("/api/auth/desktop-link/approve", {
      method: "POST",
      body: JSON.stringify({ pairing_id: pairingId }),
    }),
  denyDesktopLink: (pairingId: string) =>
    request<{ ok: boolean; message: string }>("/api/auth/desktop-link/deny", {
      method: "POST",
      body: JSON.stringify({ pairing_id: pairingId }),
    }),
  register: (username: string, email: string, password: string, acceptTerms = true) =>
    publicRequest<VerificationResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password, accept_terms: acceptTerms }),
    }),
  verifyEmail: (email: string, code: string, rememberMe = true) =>
    publicRequest<TokenResponse>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, code, remember_me: rememberMe }),
    }),
  resendSignupCode: (email: string) =>
    publicRequest<VerificationResponse>("/api/auth/resend-signup-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  login: (username: string, password: string, rememberMe = true) =>
    publicRequest<TokenResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, remember_me: rememberMe }),
    }),
  forgotPassword: (email: string) =>
    publicRequest<VerificationResponse>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (email: string, code: string, newPassword: string, rememberMe = true) =>
    publicRequest<TokenResponse>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, code, new_password: newPassword, remember_me: rememberMe }),
    }),
  requestVerification: (purpose: "change_password" | "change_username") =>
    request<VerificationResponse>("/api/auth/me/request-verification", {
      method: "POST",
      body: JSON.stringify({ purpose }),
    }),
  changeUsername: (username: string, verificationCode: string) =>
    request<User>("/api/auth/me/username", {
      method: "PATCH",
      body: JSON.stringify({ username, verification_code: verificationCode }),
    }),
  changePassword: (currentPassword: string, newPassword: string, verificationCode: string) =>
    request<{ ok: boolean; message: string }>("/api/auth/me/password", {
      method: "PATCH",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        verification_code: verificationCode,
      }),
    }),
  acceptLegal: () =>
    request<User>("/api/auth/me/accept-legal", {
      method: "PATCH",
      body: JSON.stringify({ accept_terms: true }),
    }),
  deleteAccount: (currentPassword: string) =>
    request<{ ok: boolean; message: string }>("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ current_password: currentPassword }),
    }),
  me: () => request<User>("/api/auth/me"),
  logout: () =>
    publicRequest<{ ok: boolean; message: string }>("/api/auth/logout", {
      method: "POST",
    }),
  uploadAvatar: async (file: File) => {
    const form = new FormData();
    form.append("file", file);

    const endpoints = ["/api/media/avatar", "/api/auth/me/avatar"];

    async function postAvatar(token: string, endpoint: string) {
      return fetch(apiUrl(endpoint), {
        method: "POST",
        credentials: FETCH_CREDENTIALS,
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    }

    let token = await getValidAccessToken();
    if (!token) throw new Error("Not logged in — please log in again");

    let lastRes: Response | null = null;
    for (const endpoint of endpoints) {
      let res = await postAvatar(token, endpoint);
      if (res.status === 401) {
        token = await refreshAccessToken();
        if (!token) throw new Error("Session expired — please log in again");
        res = await postAvatar(token, endpoint);
      }
      lastRes = res;
      if (res.ok) return res.json() as Promise<User>;
      if (res.status !== 404 && res.status !== 405) break;
    }

    const res = lastRes!;
    let detail = res.statusText || "Avatar upload failed";
    try {
      const err = await res.json();
      if (typeof err.detail === "string") detail = err.detail;
    } catch {
      if (res.status === 405 || res.status === 404) {
        detail =
          "Profile pictures need a server update. SSH to the VPS and run: cd ~/screen-ping && docker compose up -d --build";
      }
    }
    throw new Error(detail);
  },
  friends: () => request<Friend[]>("/api/friends"),
  requestFriend: (username: string) =>
    request<Friend>("/api/friends/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    }),
  acceptFriend: (id: string) => request<Friend>(`/api/friends/${id}/accept`, { method: "POST" }),
  declineFriend: (id: string) => request<{ ok: boolean }>(`/api/friends/${id}/decline`, { method: "POST" }),
  removeFriend: (id: string) => request<{ ok: boolean }>(`/api/friends/${id}/remove`, { method: "POST" }),
  blockFriend: (id: string) => request<{ ok: boolean }>(`/api/friends/${id}/block`, { method: "POST" }),
  unblockFriend: (id: string) => request<Friend>(`/api/friends/${id}/unblock`, { method: "POST" }),
  uploadBatch: async (receiverIds: string[], file: File, caption?: string, soundFile?: File) => {
    if (receiverIds.length === 0) throw new Error("Select at least one friend");

    const mainFile = normalizeUploadFile(file);
    const overlayFile = soundFile ? normalizeUploadFile(soundFile) : undefined;

    const url = new URL(apiUrl("/api/media/upload"));
    url.searchParams.set("receiver_ids", receiverIds.join(","));
    if (caption) url.searchParams.set("caption", caption);

    const res = await uploadWithAuth(url, mainFile, overlayFile);
    if (!res.ok) await parseUploadError(res);
    const data = (await res.json()) as { uploads: UploadResult[] };
    return data.uploads;
  },
  uploadLayers: async (
    receiverIds: string[],
    layers: LayerUploadInput[],
    caption?: string,
    soundFile?: File,
  ) => {
    if (receiverIds.length === 0) throw new Error("Select at least one friend");
    if (layers.length === 0) throw new Error("Add at least one image layer");

    const form = new FormData();
    const payload = layers.map(({ layout, opacity, zIndex }) => ({
      layout,
      opacity,
      zIndex,
    }));
    form.append("layers", JSON.stringify(payload));
    for (const layer of layers) {
      form.append("files", layer.file, layer.file.name);
    }
    if (soundFile) form.append("sound_file", normalizeUploadFile(soundFile), soundFile.name);

    const url = new URL(apiUrl("/api/media/upload-layers"));
    url.searchParams.set("receiver_ids", receiverIds.join(","));
    if (caption) url.searchParams.set("caption", caption);

    async function doUpload(token: string) {
      return fetch(url.toString(), {
        method: "POST",
        credentials: FETCH_CREDENTIALS,
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    }

    let token = await getValidAccessToken();
    if (!token) throw new Error("Not logged in — please log in again");

    let res = await doUpload(token);
    if (res.status === 401) {
      token = await refreshAccessToken();
      if (!token) throw new Error("Session expired — please log in again");
      res = await doUpload(token);
    }
    if (!res.ok) await parseUploadError(res);
    const data = (await res.json()) as { uploads: UploadResult[] };
    return data.uploads;
  },
  history: () => request<MessageHistoryItem[]>("/api/media/history"),
  desktopLatest: () =>
    request<{ version: string; download_url: string }>("/api/desktop/latest"),
};

export async function fetchDesktopLatest(): Promise<{ version: string; download_url: string }> {
  const res = await fetch(apiUrl("/api/desktop/latest"), { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load download info");
  return res.json();
}
