import { powerMonitor, app } from "electron";
import { io, Socket } from "socket.io-client";

import store from "./store";

import { DeliverPayload } from "./overlayQueue";

import { refreshAccessToken } from "./windows";
import { drawOverlay, type DrawBeginPayload, type DrawStrokePayload, type DrawSessionPayload } from "./drawOverlay";

type DeliverHandler = (payload: DeliverPayload) => void;
type RevokeHandler = (messageId: string) => void;

export interface PresenceUpdate {
  userId: string;
  isOnline: boolean;
  lastActiveAt?: string | null;
}

type FriendsUpdateHandler = (payload: Record<string, unknown>) => void;

export interface SendMessagePayload {
  receiverId: string;
  messageId: string;
  durationMs?: number;
  delayMs?: number;
  audioDelayMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  layout?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    flipX?: boolean;
    flipY?: boolean;
    objectFit?: string;
    opacity?: number;
  };
}

type PresenceHandler = (payload: PresenceUpdate) => void;

let socket: Socket | null = null;

let onSessionExpired: (() => void) | null = null;

let onPresence: PresenceHandler | null = null;

let onFriendsUpdate: FriendsUpdateHandler | null = null;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const HEARTBEAT_MS = 30_000;

function stopPresenceHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sendPresenceHeartbeat() {
  if (!socket?.connected) return;
  const idleSeconds = Math.floor(powerMonitor.getSystemIdleTime());
  socket.emit("presence:heartbeat", { idleSeconds });
}

function startPresenceHeartbeat() {
  stopPresenceHeartbeat();
  sendPresenceHeartbeat();
  heartbeatTimer = setInterval(sendPresenceHeartbeat, HEARTBEAT_MS);
}

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

export function setPresenceHandler(handler: PresenceHandler | null) {
  onPresence = handler;
}

export function setFriendsUpdateHandler(handler: FriendsUpdateHandler | null) {
  onFriendsUpdate = handler;
}

async function applyFreshAuth(): Promise<boolean> {
  const result = await refreshAccessToken();
  if (!result.ok) {
    if (result.reason === "unauthorized") {
      onSessionExpired?.();
    }
    return false;
  }
  if (socket) {
    socket.auth = { token: result.accessToken, client_type: "desktop", app_version: app.getVersion() };
  }
  return true;
}

export function connectSocket(
  onDeliver: DeliverHandler,
  onStatus?: (connected: boolean) => void,
  onRevoke?: RevokeHandler,
) {
  disconnectSocket();

  const serverUrl = store.get("serverUrl");
  const token = store.get("accessToken");

  if (!token) return;

  socket = io(serverUrl, {
    auth: { token, client_type: "desktop", app_version: app.getVersion() },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
  });

  socket.on("connect", () => {
    onStatus?.(true);
    startPresenceHeartbeat();
    void import("./versionCheck").then(({ checkLatestVersion }) => checkLatestVersion());
  });

  socket.on("disconnect", (reason) => {
    onStatus?.(false);
    stopPresenceHeartbeat();

    if (reason === "io server disconnect" || reason === "transport close") {
      void applyFreshAuth().then((ok) => {
        if (ok) socket?.connect();
      });
    }
  });

  socket.on("connect_error", async () => {
    onStatus?.(false);
    stopPresenceHeartbeat();

    const result = await refreshAccessToken();
    if (result.ok && socket) {
      socket.auth = { token: result.accessToken, client_type: "desktop", app_version: app.getVersion() };
      if (!socket.connected) socket.connect();
      return;
    }

    if (!result.ok && result.reason === "unauthorized") {
      onSessionExpired?.();
    }
  });

  socket.on("message:deliver", (payload: DeliverPayload) => {
    onDeliver(payload);
  });

  socket.on("message:revoke", (payload: { messageId?: string }) => {
    if (payload?.messageId) onRevoke?.(payload.messageId);
  });

  socket.on("draw:begin", (payload: DrawBeginPayload) => {
    drawOverlay.begin(payload);
  });

  socket.on("draw:stroke", (payload: DrawStrokePayload) => {
    drawOverlay.stroke(payload);
  });

  socket.on("draw:clear", (payload: DrawSessionPayload) => {
    drawOverlay.clear(payload);
  });

  socket.on("draw:end", (payload: DrawSessionPayload) => {
    drawOverlay.end(payload);
  });

  socket.on("desktop:update-check", () => {
    void import("./updater").then(({ checkForUpdates }) => checkForUpdates());
    void import("./versionCheck").then(({ checkLatestVersion }) => checkLatestVersion());
  });

  socket.on("presence:update", (payload: PresenceUpdate) => {
    onPresence?.(payload);
  });

  socket.on("friends:update", (payload: Record<string, unknown>) => {
    onFriendsUpdate?.(payload);
  });
}

export function disconnectSocket() {
  stopPresenceHeartbeat();
  socket?.disconnect();
  socket = null;
}

export function ackMessage(messageId: string, status: "delivered" | "failed" | "paused") {
  socket?.emit("message:ack", { messageId, status });
}

export function sendMessage(payload: SendMessagePayload) {
  if (!socket?.connected) {
    throw new Error("Not connected — reconnect and try again");
  }
  socket.emit("message:send", {
    receiverId: payload.receiverId,
    messageId: payload.messageId,
    durationMs: payload.durationMs ?? 3000,
    delayMs: payload.delayMs ?? 0,
    audioDelayMs: payload.audioDelayMs ?? 0,
    fadeInMs: payload.fadeInMs ?? 200,
    fadeOutMs: payload.fadeOutMs ?? 0,
    layout: payload.layout ?? { x: 0, y: 0, width: 100, height: 100, rotation: 0, objectFit: "contain" },
  });
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}
