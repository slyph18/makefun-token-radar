// Token Radar's CLI: score a sealed snapshot, validate the result, and stage the deliverables.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repo = fileURLToPath(new URL('.', import.meta.url));

// These limits belong to the scorer, so they are passed to the vendored dossier builder unchanged.
const dossierLimits = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const screenshotName = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name=value` or `--name value`; exact CLI behavior, including the fallbacks below. */
function argument(name: string, fallback: string): string {
  const positional = process.argv.indexOf(`--${name}`);
  if (positional >= 0 && positional + 1 < process.argv.length) return process.argv[positional + 1]!;
  const withEquals = process.argv.find((part) => part.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Accept either a snapshot file or a directory containing snapshot.json. */
function snapshotPath(value: string): string {
  return value.endsWith('.json') ? value : join(value, 'snapshot.json');
}

/** Copy regular, non-hidden files only; return their names so the screenshot gate can inspect them. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

/** Fail with the project's concise stderr line and no stack trace for staged-deliverable issues. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

function main(): void {
  const input = snapshotPath(argument('input', '/input'));
  if (!existsSync(input)) {
    process.stderr.write(`token radar: no snapshot at ${input}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  const output = argument('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

  // board.json is the data contract; data.js is the same dashboard payload without a fetch.
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(output, 'data.js'), dataScript(radar));
  copyFiles(join(repo, 'dashboard'), join(output, 'dashboard'));

  const screenshots = copyFiles(join(repo, 'screenshots'), join(output, 'screenshots'));
  if (screenshots.length < 3) {
    fail(`screenshots/ holds ${screenshots.length} image${screenshots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
  }
  for (const name of screenshots) {
    if (!screenshotName.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }

  // The dossier is last because the scorer may reconstruct and compare it against the staged output.
  writeFileSync(join(output, 'dossier.json'), buildDossier(output, dossierLimits));

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(output, 'board.json')}, ${join(output, 'data.js')}, ${join(output, 'dashboard')} (3 files), ${join(output, 'screenshots')} (${screenshots.length} images) and ${join(output, 'dossier.json')}\n`,
  );
}

main();
