import { describe, expect, it } from 'vitest';
import { generateRandomLayout, checkPlayability, generateWorldTemplate } from './random-layout';
import { validateTemplate } from './validator';

describe('D039 Random Layout and Playability', () => {
  it('generates deterministic layout with empty roads and empty entryCells', () => {
    const layout1 = generateRandomLayout('city', 12345, 0);
    const layout2 = generateRandomLayout('city', 12345, 0);
    expect(layout1).toEqual(layout2);
    expect(layout1.roads).toEqual([]);
    expect(layout1.entryCells).toEqual([]);
  });

  it('generates a playable city template that passes validateTemplate and checkPlayability', () => {
    const { template, attempt } = generateWorldTemplate('city', 20261014);
    expect(attempt).toBeLessThan(50);
    expect(validateTemplate(template)).toEqual([]);
    expect(checkPlayability(template)).toEqual([]);
  });

  it('generates a playable farm template that passes validateTemplate and checkPlayability', () => {
    const { template, attempt } = generateWorldTemplate('farm', 20261014);
    expect(attempt).toBeLessThan(50);
    expect(validateTemplate(template)).toEqual([]);
    expect(checkPlayability(template)).toEqual([]);
  });
});
