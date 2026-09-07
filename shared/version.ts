export function parseVersion(version: string): [number, number, number] {
  const parts = version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function isVersionOlder(current: string, latest: string): boolean {
  const [currentMajor, currentMinor, currentPatch] = parseVersion(current);
  const [latestMajor, latestMinor, latestPatch] = parseVersion(latest);
  if (currentMajor !== latestMajor) return currentMajor < latestMajor;
  if (currentMinor !== latestMinor) return currentMinor < latestMinor;
  return currentPatch < latestPatch;
}
