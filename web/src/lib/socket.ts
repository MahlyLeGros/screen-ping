import { io, Socket } from "socket.io-client";

import { getValidAccessToken, refreshAccessToken } from "./api";

import type { MediaLayout, CaptionLayout } from "../../../shared/types";

import { DEFAULT_FADE_IN_MS, DEFAULT_FADE_OUT_MS, DEFAULT_LAYOUT, DEFAULT_DURATION_MS } from "../../../shared/types";

export interface PresenceUpdate {
  userId: string;
  isOnline: boolean;
  lastActiveAt?: string | null;
}

export interface FriendsUpdate {
  action: string;
  friendshipId?: string;
  fromUserId?: string;
  fromUsername?: string;
}

let socket: Socket | null = null;

let onResultCb: ((data: { messageId: string; status: string; reason?: string }) => void) | undefined;

let onPresenceCb: ((data: PresenceUpdate) => void) | undefined;

const connectionListeners = new Set<(connected: boolean) => void>();

const presenceListeners = new Set<(data: PresenceUpdate) => void>();

const friendsListeners = new Set<(data: FriendsUpdate) => void>();

type DesktopUpdateResult = { ok: boolean; reason?: string };

function notifyConnection(connected: boolean) {
  connectionListeners.forEach((cb) => cb(connected));
}

function notifyPresence(data: PresenceUpdate) {
  onPresenceCb?.(data);
  presenceListeners.forEach((cb) => cb(data));
}

function notifyFriends(data: FriendsUpdate) {
  friendsListeners.forEach((cb) => cb(data));
}

export function subscribeSocketConnection(listener: (connected: boolean) => void): () => void {
  connectionListeners.add(listener);
  listener(socket?.connected ?? false);
  return () => connectionListeners.delete(listener);
}

export function subscribePresence(listener: (data: PresenceUpdate) => void): () => void {
  presenceListeners.add(listener);
  return () => presenceListeners.delete(listener);
}

export function subscribeFriends(listener: (data: FriendsUpdate) => void): () => void {
  friendsListeners.add(listener);
  return () => friendsListeners.delete(listener);
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

async function createSocket() {
  const token = await getValidAccessToken();
  if (!token) return null;

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }

  socket = io(window.location.origin, {
    auth: { token, client_type: "web" },
    transports: ["websocket", "polling"],
    reconnection: true,
  });

  socket.on("message:result", (data) => onResultCb?.(data));
  socket.on("presence:update", (data) => notifyPresence(data));
  socket.on("friends:update", (data) => notifyFriends(data));
  socket.on("connect", () => notifyConnection(true));
  socket.on("disconnect", () => notifyConnection(false));
  socket.on("connect_error", async () => {
    notifyConnection(false);
    const newToken = await refreshAccessToken();
    if (newToken && socket) {
      socket.auth = { token: newToken, client_type: "web" };
      socket.connect();
    }
  });

  return socket;
}

export function connectSocket(
  onResult?: (data: { messageId: string; status: string; reason?: string }) => void,
  onPresence?: (data: PresenceUpdate) => void,
) {
  onResultCb = onResult;
  onPresenceCb = onPresence;
  void createSocket();
  return socket;
}

export async function reconnectSocket() {
  return createSocket();
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function sendMessage(
  receiverId: string,
  messageId: string,
  durationMs = DEFAULT_DURATION_MS,
  layout: MediaLayout = DEFAULT_LAYOUT,
  delayMs = 0,
  fadeInMs = DEFAULT_FADE_IN_MS,
  fadeOutMs = DEFAULT_FADE_OUT_MS,
  audioDelayMs = 0,
  captionLayout?: CaptionLayout,
) {
  if (!socket?.connected) {
    throw new Error("Not connected — retrying...");
  }
  socket.emit("message:send", {
    receiverId,
    messageId,
    durationMs,
    delayMs,
    audioDelayMs,
    layout,
    fadeInMs,
    fadeOutMs,
    captionLayout,
  });
}

export function cancelMessage(messageId: string) {
  if (!socket?.connected) {
    throw new Error("Not connected — retrying...");
  }
  socket.emit("message:cancel", { messageId });
}

export function getSocket() {
  return socket;
}

export function requestDesktopUpdate(): Promise<DesktopUpdateResult> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error("Not connected — retrying..."));
      return;
    }

    const timeout = setTimeout(() => {
      socket?.off("desktop:update-result", onResult);
      reject(new Error("Desktop update request timed out"));
    }, 5000);

    function onResult(data: DesktopUpdateResult) {
      clearTimeout(timeout);
      socket?.off("desktop:update-result", onResult);
      resolve(data);
    }

    socket.on("desktop:update-result", onResult);
    socket.emit("desktop:update-request", {});
  });
}

export function waitForSocket(ms = 5000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (socket?.connected) {
      resolve(socket);
      return;
    }
    if (!socket) {
      reject(new Error("Not connected — please log in again"));
      return;
    }
    const timeout = setTimeout(() => reject(new Error("Could not connect to server")), ms);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket!);
    });
  });
}

export interface DrawPoint {
  x: number;
  y: number;
  /** Client draw timestamp (ms since epoch). */
  t?: number;
}

export interface DrawStartOptions {
  receiverIds: string[];
  durationMs: number;
  color: string;
  width: number;
  sessionId?: string;
}

export interface DrawResult {
  ok: boolean;
  action?: string;
  reason?: string;
  sessionId?: string;
  receiverIds?: string[];
  onlineIds?: string[];
}

function requireSocket(): Socket {
  if (!socket?.connected) {
    throw new Error("Not connected — retrying...");
  }
  return socket;
}

export function startDrawSession(options: DrawStartOptions): Promise<DrawResult> {
  return new Promise((resolve, reject) => {
    let sock: Socket;
    try {
      sock = requireSocket();
    } catch (err) {
      reject(err);
      return;
    }

    const timeout = setTimeout(() => {
      sock.off("draw:result", onResult);
      reject(new Error("Draw session start timed out"));
    }, 5000);

    function onResult(data: DrawResult) {
      if (data.action && data.action !== "start") return;
      clearTimeout(timeout);
      sock.off("draw:result", onResult);
      resolve(data);
    }

    sock.on("draw:result", onResult);
    sock.emit("draw:start", options);
  });
}

export function emitDrawStroke(payload: {
  sessionId: string;
  receiverIds: string[];
  points: DrawPoint[];
  color: string;
  width: number;
  durationMs: number;
  strokeId?: string;
}) {
  requireSocket().emit("draw:stroke", payload);
}

export function emitDrawClear(sessionId: string, receiverIds: string[]) {
  requireSocket().emit("draw:clear", { sessionId, receiverIds });
}

export function endDrawSession(sessionId: string, receiverIds: string[]): Promise<DrawResult> {
  return new Promise((resolve, reject) => {
    let sock: Socket;
    try {
      sock = requireSocket();
    } catch (err) {
      reject(err);
      return;
    }

    const timeout = setTimeout(() => {
      sock.off("draw:result", onResult);
      resolve({ ok: true, action: "end", sessionId });
    }, 2000);

    function onResult(data: DrawResult) {
      if (data.sessionId && data.sessionId !== sessionId) return;
      if (data.action && data.action !== "end") return;
      clearTimeout(timeout);
      sock.off("draw:result", onResult);
      resolve(data);
    }

    sock.on("draw:result", onResult);
    sock.emit("draw:end", { sessionId, receiverIds });
  });
}
