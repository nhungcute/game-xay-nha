import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateTemplate } from '@xay-nha/worldgen';
import { buildTemplate } from './template';

interface CliIO { out: (message: string) => void; error: (message: string) => void }

export async function runCli(args: string[], io: CliIO = { out: console.log, error: console.error }): Promise<number> {
  const [command, inputPath, outputPath, ...extra] = args;
  if (!inputPath || extra.length || (command !== 'validate-template' && command !== 'build-template') || (command === 'validate-template' && outputPath)) {
    io.error('Usage: pnpm tooling validate-template <template.json> | build-template <layout.json> [output.json]');
    return 2;
  }
  try {
    const input: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
    if (command === 'validate-template') {
      const errors = validateTemplate(input);
      if (errors.length) { errors.forEach(error => io.error(error)); return 1; }
      io.out(`VALID ${inputPath}`);
    } else {
      const template = buildTemplate(input);
      const destination = outputPath ?? inputPath.replace(/(?:\.layout)?\.json$/i, '.template.v1.json');
      if (destination === inputPath) throw new Error('Output path must differ from input layout');
      await writeFile(destination, JSON.stringify(template) + '\n', 'utf8');
      io.out(`BUILT ${destination} (provisional rule fixture, not final map)`);
    }
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runCli(process.argv.slice(2));
