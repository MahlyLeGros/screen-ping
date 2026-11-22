export function slideshowTiming(count: number, seconds: number) {
  const frames = Math.min(Math.max(Math.ceil(60 / count), Math.round(seconds * 30)), Math.floor(900 / count));
  return { seconds: frames / 30, transition: Math.min(7, Math.floor(frames / 4)) / 30, duration: frames * count / 30 };
}
