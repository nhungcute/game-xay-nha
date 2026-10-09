import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli';
import { buildTemplate } from './template';
import { validateTemplate } from '@xay-nha/worldgen';

const layout = { schemaVersion: 1, provisional: true, kind: 'rule-fixture', mapKind: 'farm', mapId: 'farm-test-01', seed: 20261009 };
describe('template tooling', () => {
  it('builds the authored fixture and rejects unsupported fields', () => {
    expect(validateTemplate(buildTemplate(layout))).toEqual([]);
    expect(() => buildTemplate({ ...layout, buildings: [] })).toThrow('Unknown layout field');
    expect(() => buildTemplate({ ...layout, mapKind: 'eco' })).toThrow('mapKind');
  });
  it('CLI builds and then validates a persisted fixture', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xay-nha-template-'));
    try {
      const input = join(directory, 'fixture.layout.json'), output = join(directory, 'template.json'), messages: string[] = [];
      const io = { out: (message: string) => messages.push(message), error: (message: string) => messages.push(message) };
      await writeFile(input, JSON.stringify(layout));
      expect(await runCli(['build-template', input, output], io)).toBe(0);
      expect(await runCli(['validate-template', output], io)).toBe(0);
      expect(messages.some(message => message.startsWith('VALID'))).toBe(true);
      const template = JSON.parse(await readFile(output, 'utf8')) as Record<string, unknown>;
      expect(template.mapId).toBe('farm-test-01');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('CLI fails missing input, bad JSON, bad layout, invalid template; never overwrites previous output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xay-nha-template-'));
    try {
      const input = join(directory, 'bad.json'), output = join(directory, 'output.json'), errors: string[] = [];
      const io = { out: () => undefined, error: (message: string) => errors.push(message) };
      await writeFile(output, 'keep-existing');
      await writeFile(input, '{');
      expect(await runCli(['build-template', input, output], io)).toBe(1);
      await writeFile(input, '{}');
      expect(await runCli(['build-template', input, output], io)).toBe(1);
      expect(await readFile(output, 'utf8')).toBe('keep-existing');
      expect(await runCli(['validate-template', input], io)).toBe(1);
      expect(await runCli(['validate-template', join(directory, 'missing.json')], io)).toBe(1);
      expect(await runCli([], io)).toBe(2);
      expect(errors.length).toBeGreaterThan(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
