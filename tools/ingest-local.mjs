#!/usr/bin/env node
/**
 * ingest-local.mjs
 *
 * Normalises artifacts exported from a live Fusion AI Agent Studio environment
 * into the same on-disk shape the repo corpus uses, so the extractor can read
 * your own apps and workflows alongside Oracle's samples.
 *
 * Two export shapes come out of the product and they are not the same:
 *
 *   Applications  a single .json download whose `specification` is a JSON
 *                 *string*, not an object. Left as-is the extractor sees no
 *                 applicationMetadata and the app contributes nothing.
 *   Workflows     a .zip containing a ready-made src/ tree (workflows,
 *                 agents, businessObjects, tools) with object specifications.
 *
 * So: unzip archives, sniff every JSON by its keys rather than trusting the
 * file extension, parse any stringified specification, and write each artifact
 * to src/<kind>/<code>.<ext>.
 *
 * Usage:
 *   node tools/ingest-local.mjs                       # scan the default folders
 *   node tools/ingest-local.mjs path/to/export.json path/to/wf.zip ...
 *   node tools/ingest-local.mjs --out .source/local --clean
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const HERE = path.dirname(new URL(import.meta.url).pathname);
const KG_ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(arg('--out', path.join(KG_ROOT, '.source/local')));

/** Where to look when no paths are given. */
const DEFAULT_INPUTS = [
  path.join(KG_ROOT, 'local'),
  path.resolve(KG_ROOT, '../CustomAgentArtifacts'),
];

const inputs = argv.filter((a) => !a.startsWith('--') && a !== arg('--out', null));
const roots = (inputs.length ? inputs : DEFAULT_INPUTS)
  .map((p) => path.resolve(p))
  .filter((p) => fs.existsSync(p));

if (!roots.length) {
  console.log('[ingest] nothing to do — no input paths exist.');
  console.log('         drop exports into  local/  then re-run, or pass paths:');
  console.log('         node tools/ingest-local.mjs MY_APP.json my_workflow.zip');
  process.exit(0);
}

// ---------------------------------------------------------------- artifact kinds

/**
 * How to recognise each artifact and where it belongs. Order matters: the first
 * matching test wins, so the more specific tests come first.
 */
const KINDS = [
  { kind: 'workflow', dir: 'workflows', ext: '.wf',
    test: (d) => !!d.workflowCode || !!spec(d)?.dataPipeline,
    code: (d) => d.workflowCode },
  { kind: 'app', dir: 'apps', ext: '.app',
    test: (d) => !!spec(d)?.applicationMetadata,
    code: (d) => d.code },
  { kind: 'agent', dir: 'agents', ext: '.agent',
    test: (d) => !!d.agentCode,
    code: (d) => d.agentCode },
  { kind: 'businessObject', dir: 'businessObjects', ext: '.bo',
    test: (d) => !!d.objectCode || !!d.objectProperties,
    code: (d) => d.objectCode },
  { kind: 'tool', dir: 'tools', ext: '.tool',
    test: (d) => !!d.toolCode,
    code: (d) => d.toolCode },
  { kind: 'deeplink', dir: 'deeplinks', ext: '.dl',
    test: (d) => !!d.deepLinkCode,
    code: (d) => d.deepLinkCode },
  { kind: 'topic', dir: 'topics', ext: '.topic',
    test: (d) => !!d.topicCode,
    code: (d) => d.topicCode },
  { kind: 'function', dir: 'functions', ext: '.function',
    test: (d) => !!d.functionCode || !!d.templateCode,
    code: (d) => d.functionCode ?? d.templateCode },
  { kind: 'documentSchema', dir: 'documentSchemas', ext: '.documentSchema',
    test: (d) => !!d.documentSchemaCode,
    code: (d) => d.documentSchemaCode },
  { kind: 'approval', dir: 'approvals', ext: '.approval',
    test: (d) => !!d.approvalCode || !!d.moduleIdentifier,
    code: (d) => d.approvalCode ?? d.moduleIdentifier },
  { kind: 'policy', dir: 'policies', ext: '.policy',
    test: (d) => !!d.policyCode,
    code: (d) => d.policyCode },
];

/** `specification` arrives as an object from a zip and a JSON string from a
 *  single-file app download. Normalise before testing anything against it. */
function spec(d) {
  const s = d?.specification;
  if (!s) return null;
  if (typeof s === 'object') return s;
  if (typeof s === 'string') {
    try { return JSON.parse(s); } catch { return null; }
  }
  return null;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// ---------------------------------------------------------------- collect files

const staging = [];   // { file, from }
const tmpDirs = [];

function collect(p, from = p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p)) collect(path.join(p, e), from);
    return;
  }
  if (p.toLowerCase().endsWith('.zip')) {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'fkg-ingest-'));
    tmpDirs.push(tmp);
    try {
      // unzip via the system tool; avoids taking on a dependency for this
      execFileSync('/usr/bin/unzip', ['-q', '-o', p, '-d', tmp], { stdio: 'pipe' });
      console.log(`[ingest] unzipped ${path.basename(p)}`);
      collect(tmp, p);
    } catch (err) {
      console.warn(`[ingest] could not unzip ${p}: ${err.message}`);
    }
    return;
  }
  staging.push({ file: p, from });
}

for (const r of roots) collect(r);

// ---------------------------------------------------------------- classify + write

if (flag('--clean') && fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const written = [];
const skipped = [];

for (const { file, from } of staging) {
  const base = path.basename(file);
  if (base.startsWith('.') || base === 'app-package.json') { skipped.push([base, 'not an artifact']); continue; }

  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { skipped.push([base, 'unreadable']); continue; }
  if (!raw.trim().startsWith('{')) { skipped.push([base, 'not JSON']); continue; }

  let doc;
  try { doc = JSON.parse(raw); } catch (err) { skipped.push([base, `bad JSON: ${err.message}`]); continue; }

  const hit = KINDS.find((k) => { try { return k.test(doc); } catch { return false; } });
  if (!hit) { skipped.push([base, 'unrecognised shape']); continue; }

  // parse a stringified specification so downstream code sees one shape only
  const parsed = spec(doc);
  if (parsed && typeof doc.specification === 'string') {
    doc.specification = parsed;
    console.log(`[ingest] ${base}: parsed stringified specification`);
  }

  const code = hit.code(doc) || path.basename(base, path.extname(base));
  const dir = path.join(OUT, 'src', hit.dir);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${slug(code)}${hit.ext}`);
  fs.writeFileSync(target, JSON.stringify(doc, null, 2));
  written.push({ kind: hit.kind, code, target: path.relative(OUT, target), from: path.relative(KG_ROOT, from) });
}

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });

fs.writeFileSync(
  path.join(OUT, 'ingest-manifest.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), roots, artifacts: written }, null, 2),
);

// ---------------------------------------------------------------- report

console.log(`\n[ingest] scanned ${roots.length} location(s): ${roots.map((r) => path.relative(KG_ROOT, r)).join(', ')}`);
console.log(`[ingest] wrote ${written.length} artifact(s) to ${path.relative(KG_ROOT, OUT)}/src\n`);

const byKind = {};
for (const w of written) (byKind[w.kind] ??= []).push(w);
for (const [kind, list] of Object.entries(byKind).sort()) {
  console.log(`  ${kind} (${list.length})`);
  for (const w of list) console.log(`    ${w.code.padEnd(34)} <- ${w.from}`);
}
if (skipped.length) {
  const real = skipped.filter(([, why]) => why !== 'not an artifact');
  if (real.length) {
    console.log('\n  skipped:');
    for (const [f, why] of real.slice(0, 12)) console.log(`    ${f} — ${why}`);
  }
}
console.log('\n[ingest] next: node tools/extract-fusion-graph.mjs   (or ./run.sh)');
