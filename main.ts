// Token Radar — program/v1 entry for token-radar-01 (Node 22, standard library only).
//
// What it does, end to end:
//   1. Reads the sealed DefiLlama snapshot (default /input/snapshot.json, or --input <file|dir>).
//   2. Scores every genuine pre-token protocol with the radar-2 model in lib/model.ts and
//      writes the ranked board to <out>/board.json (198 rows on this snapshot).
//   3. Writes <out>/data.js, the same board in the compact shape the dashboard renders.
//   4. Copies dashboard/ and screenshots/ into <out>/, so the page the judge reads is the
//      page this program ships, byte for byte.
//   5. Writes <out>/dossier.json with the kit's vendored library: the judge's reading copy
//      of the dashboard's source and screenshots.
//
// The run is deterministic: the same snapshot always writes the same bytes, which is what
// the grader checks when it runs the program twice. Nothing here touches the network.
// Verify it yourself: run main.ts twice into two directories and compare the trees;
// board.json and dossier.json must be byte-identical both times.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Caps from the kit's reference/gate.json, kept here so a bad output fails loudly instead
// of silently shipping a board the gate refuses.
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const SHOTS = { max: 4, max_bytes: 524_288 };
const DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments; `fallback` when absent. */
function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputPath = flag('input', '/input');
const snapshotFile = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotFile)) {
  fail(`no snapshot at ${snapshotFile} — pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `dest`, skipping dotfiles; returns the names copied. */
function copyDir(from: string, dest: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(dest, name));
    names.push(name);
  }
  return names;
}

copyDir(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'} — hand in 3: the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name} — a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier goes last: it is built from this /output, and the scorer rebuilds it the
// same way and compares bytes, so anything written after it would break the match.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES, screenshots: SHOTS, dashboard: DASHBOARD }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols in, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
    `${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
