export interface DisplayInfo {
  id: number;
  label: string;
  shortLabel: string;
  primary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "up-to-date"
  | "error";

export interface DesktopState {
  version: string;
  packaged: boolean;
  username: string | null;
  userId: string | null;
  serverUrl: string;
  connected: boolean;
  online: boolean;
  paused: boolean;
  launchAtLogin: boolean;
  alwaysOnTop: boolean;
  compact: boolean;
  overlayDisplayId: number | null;
  displays: DisplayInfo[];
  update: {
    state: UpdateState;
    version?: string;
    percent?: number;
    transferred?: number;
    total?: number;
    bytesPerSecond?: number;
    message?: string;
  };
  latestVersion: string | null;
  outdated: boolean;
}

export type SettingKey = "online" | "paused" | "launchAtLogin" | "alwaysOnTop" | "compact" | "overlayDisplayId";

export type AppTab = "receive" | "friends" | "send";

export type ActionName =
  | "open-window"
  | "reconnect"
  | "logout"
  | "quit"
  | "check-updates"
  | "install-update"
  | "cancel-update"
  | "open-dashboard"
  | "open-kofi"
  | "open-friends"
  | "open-send";

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

export interface PresenceUpdate {
  userId: string;
  isOnline: boolean;
  lastActiveAt?: string | null;
}

export interface UploadResult {
  message_id: string;
  receiver_id: string;
  media_type: string;
  media_url: string;
  audio_url?: string | null;
}

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
    objectFit?: string;
    opacity?: number;
  };
}

export interface DesktopAPI {
  getState: () => Promise<DesktopState>;
  onState: (callback: (state: DesktopState) => void) => void;
  set: (key: SettingKey, value: boolean | number | null) => void;
  action: (name: ActionName) => void;
  minimize: () => void;
  close: () => void;
  resizeToContent: (height: number) => void;
  resizeMenu: (width: number, height: number) => void;
  hideMenu: () => void;
  onOpenTab: (callback: (tab: AppTab) => void) => void;
  onPresence: (callback: (payload: PresenceUpdate) => void) => void;
  onFriendsUpdate: (callback: () => void) => void;
  friends: {
    list: () => Promise<Friend[]>;
    request: (username: string) => Promise<Friend>;
    accept: (id: string) => Promise<Friend>;
    decline: (id: string) => Promise<{ ok: boolean }>;
    remove: (id: string) => Promise<{ ok: boolean }>;
    block: (id: string) => Promise<{ ok: boolean }>;
    unblock: (id: string) => Promise<Friend>;
  };
  uploadMedia: (payload: {
    receiverIds: string[];
    filePath: string;
    caption?: string;
    soundPath?: string;
  }) => Promise<UploadResult[]>;
  sendMessage: (payload: SendMessagePayload) => Promise<{ ok: boolean }>;
  pickMedia: () => Promise<string | null>;
  pickAudio: () => Promise<string | null>;
}

declare global {
  interface Window {
    desktopAPI: DesktopAPI;
  }
}

export {};
