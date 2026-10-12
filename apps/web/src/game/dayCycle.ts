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
  /** Linear RGB multiplier for unlit (MeshBasic) materials so they darken like lit surfaces; exactly 1 by day. */
  unlitTint: readonly [number, number, number];
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

function linearRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(index => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

/** Sun incidence used to weigh sun against sky light on a typical lit surface (upward-facing, sun ~53° high). */
const REFERENCE_SUN_COS = 0.8;

/** Per-channel diffuse irradiance a lit surface receives: sun × incidence + hemisphere sky (three's Lambert terms). */
function irradiance(sunColor: string, sunIntensity: number, skyColor: string, hemisphereIntensity: number): [number, number, number] {
  const sun = linearRgb(sunColor), sky = linearRgb(skyColor);
  return [0, 1, 2].map(channel => sun[channel]! * sunIntensity * REFERENCE_SUN_COS + sky[channel]! * hemisphereIntensity) as [number, number, number];
}

const DAY_IRRADIANCE = irradiance(DAY.sunColor, DAY.sunIntensity, DAY.hemisphereSkyColor, DAY.hemisphereIntensity);

/** Pure, continuous day/night curve used by both the renderer and QA tests. */
export function lighting(hour: number, mode: TimeOfDayMode = 'auto'): LightingState {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const night = mode === 'day' ? 0 : mode === 'night' ? 1 : nightAt(normalizedHour);
  const blend = night;
  const phase = normalizedHour / 24 * Math.PI * 2;
  const elevation = Math.max(0.2, Math.cos((normalizedHour - 12) / 12 * Math.PI) * 0.8 + 0.2);
  const sunColor = mixHex(DAY.sunColor, NIGHT.sunColor, blend);
  const sunIntensity = DAY.sunIntensity + (NIGHT.sunIntensity - DAY.sunIntensity) * blend;
  const hemisphereSkyColor = mixHex(DAY.hemisphereSkyColor, NIGHT.hemisphereSkyColor, blend);
  const hemisphereIntensity = DAY.hemisphereIntensity + (NIGHT.hemisphereIntensity - DAY.hemisphereIntensity) * blend;
  const current = irradiance(sunColor, sunIntensity, hemisphereSkyColor, hemisphereIntensity);
  return {
    hour: normalizedHour, night,
    sunColor, sunIntensity, hemisphereSkyColor,
    hemisphereGroundColor: mixHex(DAY.hemisphereGroundColor, NIGHT.hemisphereGroundColor, blend),
    hemisphereIntensity,
    backgroundColor: mixHex(DAY.backgroundColor, NIGHT.backgroundColor, blend),
    fogColor: mixHex(DAY.fogColor, NIGHT.fogColor, blend),
    exposure: DAY.exposure + (NIGHT.exposure - DAY.exposure) * blend,
    sunDirection: [Math.cos(phase) * 50, Math.max(8, elevation * 90), Math.sin(phase) * 40],
    unlitTint: blend === 0 ? [1, 1, 1] : current.map((value, channel) => value / DAY_IRRADIANCE[channel]!) as [number, number, number],
  };
}

export function hourFromTimestamp(timestamp: number): number {
  return new Date(timestamp).getHours() + new Date(timestamp).getMinutes() / 60 + new Date(timestamp).getSeconds() / 3600;
}
