import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { api, type User } from "../lib/api";
import Avatar from "./Avatar";
import AvatarCropModal from "./AvatarCropModal";

export default function ProfileAvatarButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  function onPickFile(file: File | null) {
    if (!file) return;
    setError("");
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(URL.createObjectURL(file));
    if (inputRef.current) inputRef.current.value = "";
  }

  function closeCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }

  async function uploadCropped(file: File) {
    closeCrop();
    setUploading(true);
    try {
      const updated = await api.uploadAvatar(file);
      const avatarUrl = updated.avatar_url
        ? `${updated.avatar_url}${updated.avatar_url.includes("?") ? "&" : "?"}v=${Date.now()}`
        : null;
      setUser({ ...updated, avatar_url: avatarUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          to="/settings"
          className="btn-ghost inline-flex p-1.5 sm:hidden"
          aria-label="Account settings"
          title="Account settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </Link>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || !!cropSrc}
          aria-label="Change profile picture"
          title="Change profile picture"
          className="group relative shrink-0 rounded-full p-0 leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50"
        >
          <Avatar
            name={user?.username ?? "?"}
            src={user?.avatar_url}
            size="sm"
            className="transition group-hover:shadow-glow-xs"
          />
          <span className="pointer-events-none absolute inset-0 flex size-full items-center justify-center rounded-full bg-black/0 text-[9px] font-medium text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
            {uploading ? "…" : "Edit"}
          </span>
        </button>
        {user && (
          <Link
            to="/settings"
            className="hidden text-sm text-slate-400 transition hover:text-white sm:inline"
            title="Account settings"
          >
            {user.username}
          </Link>
        )}
        {error && (
          <span role="alert" className="max-w-[8rem] truncate text-xs text-red-400">
            {error}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0] || null)}
        />
      </div>

      {cropSrc && (
        <AvatarCropModal
          imageSrc={cropSrc}
          onCancel={closeCrop}
          onConfirm={(file) => void uploadCropped(file)}
        />
      )}
    </>
  );
}
