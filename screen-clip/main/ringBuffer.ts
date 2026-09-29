import fs from "fs";
import path from "path";

/** Keep the newest `keepCount` segment files; delete older ones. */
export function pruneSegments(segmentDir: string, keepCount: number, pattern = /^seg_\d+\.mkv$/): string[] {
  if (!fs.existsSync(segmentDir)) return [];
  const files = fs
    .readdirSync(segmentDir)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const full = path.join(segmentDir, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);

  const drop = files.slice(0, Math.max(0, files.length - keepCount));
  for (const item of drop) {
    try {
      fs.unlinkSync(item.full);
    } catch {
      /* ignore */
    }
  }
  return files.slice(Math.max(0, files.length - keepCount)).map((f) => f.full);
}

/** Select the newest N segment files for a clip flush. */
export function selectSegmentsForFlush(
  segmentDir: string,
  neededCount: number,
  pattern = /^seg_\d+\.mkv$/,
): string[] {
  if (!fs.existsSync(segmentDir)) return [];
  return fs
    .readdirSync(segmentDir)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const full = path.join(segmentDir, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime)
    .slice(-neededCount)
    .map((f) => f.full);
}

/** Write an FFmpeg concat demuxer list. */
export function writeConcatList(segmentPaths: string[], listPath: string): void {
  const body = segmentPaths
    .map((p) => {
      const escaped = p.replace(/\\/g, "/").replace(/'/g, "'\\''");
      return `file '${escaped}'`;
    })
    .join("\n");
  fs.writeFileSync(listPath, body, "utf8");
}

export function formatClipFilename(date: Date, ext: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `clip_${stamp}.${ext}`;
}
