export type TimeOfDayMode = 'auto' | 'day' | 'night';
const MODE_KEY = 'xay-nha.time-of-day';

export function loadTimeOfDayMode(): TimeOfDayMode {
  try { const value = localStorage.getItem(MODE_KEY); if (value === 'auto' || value === 'day' || value === 'night') return value; } catch { /* storage blocked */ }
  return 'auto';
}

export function saveTimeOfDayMode(mode: TimeOfDayMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage blocked: still applies for this session */ }
}

export interface LightingState {
  hour: number;
  night: number;
  sunColor: string;
  sunIntensity: number;
  hemisphereSkyColor: string;
  hemisphereGroundColor: string;
  hemisphereIntensity: number;
  backgroundColor: string;
  fogColor: string;
  exposure: number;
  sunDirection: readonly [number, number, number];
}

const DAY = {
  sunColor: '#fff0d5', sunIntensity: 2.1,
  hemisphereSkyColor: '#d6edff', hemisphereGroundColor: '#566c37', hemisphereIntensity: 1.25,
  backgroundColor: '#b6d4ce', fogColor: '#b6d4ce', exposure: 0.85,
};
const NIGHT = {
  sunColor: '#9bb8d6', sunIntensity: 0.62,
  hemisphereSkyColor: '#29476f', hemisphereGroundColor: '#1d2d2b', hemisphereIntensity: 0.78,
  backgroundColor: '#18304d', fogColor: '#18304d', exposure: 0.78,
};

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function nightAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h < 17) return 0;
  if (h >= 19 || h < 5) return 1;
  if (h < 7) return 1 - smoothstep((h - 5) / 2);
  return smoothstep((h - 17) / 2);
}

function mixHex(a: string, b: string, amount: number): string {
  const parse = (value: string) => [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  const left = parse(a), right = parse(b);
  return `#${left.map((channel, index) => Math.round(channel + (right[index]! - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/** Pure, continuous day/night curve used by both the renderer and QA tests. */
export function lighting(hour: number, mode: TimeOfDayMode = 'auto'): LightingState {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const night = mode === 'day' ? 0 : mode === 'night' ? 1 : nightAt(normalizedHour);
  const blend = night;
  const phase = normalizedHour / 24 * Math.PI * 2;
  const elevation = Math.max(0.2, Math.cos((normalizedHour - 12) / 12 * Math.PI) * 0.8 + 0.2);
  return {
    hour: normalizedHour, night,
    sunColor: mixHex(DAY.sunColor, NIGHT.sunColor, blend),
    sunIntensity: DAY.sunIntensity + (NIGHT.sunIntensity - DAY.sunIntensity) * blend,
    hemisphereSkyColor: mixHex(DAY.hemisphereSkyColor, NIGHT.hemisphereSkyColor, blend),
    hemisphereGroundColor: mixHex(DAY.hemisphereGroundColor, NIGHT.hemisphereGroundColor, blend),
    hemisphereIntensity: DAY.hemisphereIntensity + (NIGHT.hemisphereIntensity - DAY.hemisphereIntensity) * blend,
    backgroundColor: mixHex(DAY.backgroundColor, NIGHT.backgroundColor, blend),
    fogColor: mixHex(DAY.fogColor, NIGHT.fogColor, blend),
    exposure: DAY.exposure + (NIGHT.exposure - DAY.exposure) * blend,
    sunDirection: [Math.cos(phase) * 50, Math.max(8, elevation * 90), Math.sin(phase) * 40],
  };
}

export function hourFromTimestamp(timestamp: number): number {
  return new Date(timestamp).getHours() + new Date(timestamp).getMinutes() / 60 + new Date(timestamp).getSeconds() / 3600;
}
