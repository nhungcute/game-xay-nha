export type PlayStyle = 'cham' | 'thuong' | 'nhan';
export interface PlayerSchedule { day1: readonly (readonly [number, number])[]; daily: readonly (readonly [number, number])[] }

/** Bot observation/input timings copied from docs/tools/economy/model.mjs PLAYERS, not balance values. */
export const PLAYER_SCHEDULES: Record<PlayStyle, PlayerSchedule> = {
  cham: { day1: [[480, 60], [720, 15], [1020, 15], [1260, 15]], daily: [[420, 15], [720, 15], [1020, 15], [1260, 15]] },
  thuong: { day1: [[1200, 25]], daily: [[480, 8], [750, 8], [1260, 10]] },
  nhan: { day1: [[1260, 15]], daily: [[1260, 10]] },
};
export interface Session { start: number; end: number; day: number }
export function sessions(style: PlayStyle, days: number): Session[] {
  const schedule = PLAYER_SCHEDULES[style];
  return Array.from({ length: days }, (_, day) => (day ? schedule.daily : schedule.day1)
    .map(([start, length]) => ({ start: day * 1440 + start, end: day * 1440 + start + length, day: day + 1 }))).flat();
}
export function nextHarvestMinute(ready: number, all: Session[]): number {
  const session = all.find(item => item.end >= ready);
  return session ? Math.max(ready, session.start) : ready;
}
