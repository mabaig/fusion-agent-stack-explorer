#!/usr/bin/env node
/**
 * build-obsidian-vault.mjs
 *
 * Turns graph/fusion-graph.json into an Obsidian vault: one note per graph
 * node, wikilinks for every edge, typed YAML frontmatter for Properties /
 * Dataview queries, and a Mermaid control+data-flow diagram on every workflow
 * note. Obsidian's own graph view then renders the knowledge graph natively,
 * and its search covers every prompt, expression and JS snippet in the corpus.
 *
 * Usage:
 *   node tools/build-obsidian-vault.mjs [--graph <path>] [--out <vault dir>]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};
const HERE = path.dirname(new URL(import.meta.url).pathname);
const KG_ROOT = path.resolve(HERE, '..');
const GRAPH = path.resolve(arg('--graph', path.join(KG_ROOT, 'graph/fusion-graph.json')));
const VAULT = path.resolve(arg('--out', path.join(KG_ROOT, 'vault')));

const graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));

// ---------------------------------------------------------------- layout

/** Folder per node type. Types absent here get no note of their own. */
const FOLDER = {
  app: 'Apps',
  workflow: 'Workflows',
  workflowNode: 'Workflow Nodes',
  businessObject: 'Business Objects',
  boFunction: 'BO Functions',
  tool: 'Tools',
  deeplink: 'Deeplinks',
  skill: 'Skills',
  promptReference: 'Prompt References',
  cliCommand: 'CLI Commands',
  doc: 'Docs',
  appPanel: 'App Panels',
  appSubPanel: 'App Panels',
  appAction: 'App Actions',
  family: 'Taxonomy',
  product: 'Taxonomy',
  artifactType: 'Taxonomy',
  modelConfiguration: 'Taxonomy',
  restResource: 'REST Resources',
  appStage: 'Concepts',
  appContextKey: 'Concepts',
  commandGroup: 'Concepts',
  commandVerb: 'Concepts',
  policy: 'Concepts',
  issue: 'Findings',
  docSection: null, // rolled into their skill note
};

/** Structural workflow nodes carry no searchable content — diagram only. */
const STRUCTURAL_NODE_TYPES = new Set(['START', 'END', 'ADD']);

const sanitize = (s) =>
  String(s)
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 110) || 'untitled';

/** id -> vault-relative path without extension, unique across the vault. */
const notePath = new Map();
const taken = new Set();

function claim(dir, base) {
  let p = dir ? `${dir}/${base}` : base;
  let i = 2;
  while (taken.has(p.toLowerCase())) {
    p = `${dir ? dir + '/' : ''}${base} (${i++})`;
  }
  taken.add(p.toLowerCase());
  return p;
}

for (const n of graph.nodes) {
  const folder = FOLDER[n.type];
  if (folder === null || folder === undefined) continue;
  if (n.type === 'workflowNode' && STRUCTURAL_NODE_TYPES.has(n.nodeType)) continue;

  let dir = folder;
  let base = sanitize(n.label);
  if (n.type === 'workflowNode') {
    // group by owning workflow so repeated node names stay distinguishable
    dir = `${folder}/${sanitize(n.workflow)}`;
    base = sanitize(n.code);
  } else if (n.type === 'boFunction') {
    dir = `${folder}/${sanitize(n.businessObject ?? 'unknown')}`;
    base = sanitize(n.code ?? n.label);
  } else if (n.type === 'appPanel' || n.type === 'appSubPanel' || n.type === 'appAction') {
    dir = `${folder}/${sanitize(n.app ?? 'unknown')}`;
  } else if (n.type === 'restResource') {
    base = sanitize(n.label.replace(/^\//, '').replace(/\//g, ' · '));
  }
  notePath.set(n.id, claim(dir, base));
}

const link = (id, display) => {
  const p = notePath.get(id);
  const n = byId.get(id);
  if (!p) return display ?? n?.label ?? id; // no note (structural node) — plain text
  const label = display ?? n?.label ?? id;
  return path.posix.basename(p) === label ? `[[${p}]]` : `[[${p}|${label}]]`;
};

// ---------------------------------------------------------------- adjacency

const out = new Map(); // id -> [{relation, target, context}]
const inc = new Map();
for (const e of graph.edges) {
  if (!out.has(e.source)) out.set(e.source, []);
  out.get(e.source).push(e);
  if (!inc.has(e.target)) inc.set(e.target, []);
  inc.get(e.target).push(e);
}
const outs = (id) => out.get(id) ?? [];
const incs = (id) => inc.get(id) ?? [];

// ---------------------------------------------------------------- YAML

const yamlScalar = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => JSON.stringify(String(x))).join(', ')}]` : null;
  const s = String(v).trim();
  return s ? JSON.stringify(s) : null;
};

function frontmatter(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    const s = yamlScalar(v);
    if (s !== null) lines.push(`${k}: ${s}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// ---------------------------------------------------------------- mermaid

const MERMAID_SHAPE = {
  START: (id, l) => `${id}(["${l}"])`,
  END: (id, l) => `${id}(["${l}"])`,
  SWITCH: (id, l) => `${id}{"${l}"}`,
  CONDITION: (id, l) => `${id}{"${l}"}`,
  LLM: (id, l) => `${id}["${l}"]`,
  CODE: (id, l) => `${id}[/"${l}"/]`,
  BO_FUNCTION: (id, l) => `${id}[("${l}")]`,
  DOCUMENT_PROCESSOR: (id, l) => `${id}[("${l}")]`,
  WORKFLOW: (id, l) => `${id}[["${l}"]]`,
  TOOL: (id, l) => `${id}[/"${l}"\\]`,
  PARALLEL: (id, l) => `${id}[["${l}"]]`,
  LOOP: (id, l) => `${id}[["${l}"]]`,
  WHILE: (id, l) => `${id}[["${l}"]]`,
};

const mmId = (() => {
  const cache = new Map();
  let i = 0;
  return (id) => {
    if (!cache.has(id)) cache.set(id, `n${i++}`);
    return cache.get(id);
  };
})();

const mmLabel = (s) => String(s).replace(/"/g, "'").replace(/[\n\r]+/g, ' ').slice(0, 60);

/** Control-flow + data-flow diagram for one workflow. */
function workflowMermaid(wfId) {
  const memberIds = outs(wfId)
    .filter((e) => e.relation === 'contains')
    .map((e) => e.target);
  if (!memberIds.length) return null;
  const members = new Set(memberIds);

  const lines = ['```mermaid', 'flowchart TD'];
  for (const id of memberIds) {
    const n = byId.get(id);
    if (!n) continue;
    const shape = MERMAID_SHAPE[n.nodeType] ?? ((i, l) => `${i}["${l}"]`);
    lines.push(`  ${shape(mmId(id), mmLabel(n.label))}`);
  }
  const seen = new Set();
  for (const id of memberIds) {
    for (const e of outs(id)) {
      if (!members.has(e.target)) continue;
      const key = `${e.source}>${e.target}>${e.relation}>${e.context ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = mmId(e.source);
      const b = mmId(e.target);
      if (e.relation === 'flows_to') {
        const lbl = e.context && e.context !== 'success' ? `|"${mmLabel(e.context)}"|` : '';
        lines.push(`  ${a} -->${lbl} ${b}`);
      } else if (e.relation === 'reads_output_of') {
        lines.push(`  ${b} -.->|data| ${a}`);
      } else if (e.relation === 'on_error_to') {
        lines.push(`  ${a} -.->|error| ${b}`);
      }
    }
  }
  // colour by node role
  const cls = { llm: [], data: [], code: [], route: [], sub: [] };
  for (const id of memberIds) {
    const t = byId.get(id)?.nodeType;
    if (t === 'LLM') cls.llm.push(mmId(id));
    else if (t === 'BO_FUNCTION' || t === 'DOCUMENT_PROCESSOR') cls.data.push(mmId(id));
    else if (t === 'CODE') cls.code.push(mmId(id));
    else if (t === 'SWITCH' || t === 'CONDITION') cls.route.push(mmId(id));
    else if (t === 'WORKFLOW' || t === 'TOOL') cls.sub.push(mmId(id));
  }
  const STYLE = {
    llm: 'fill:#e8f0fe,stroke:#4285f4',
    data: 'fill:#e6f4ea,stroke:#34a853',
    code: 'fill:#fef7e0,stroke:#f9ab00',
    route: 'fill:#fce8e6,stroke:#ea4335',
    sub: 'fill:#f3e8fd,stroke:#a142f4',
  };
  for (const [k, ids] of Object.entries(cls)) {
    if (!ids.length) continue;
    lines.push(`  classDef ${k} ${STYLE[k]}`);
    lines.push(`  class ${ids.join(',')} ${k}`);
  }
  lines.push('```');
  return lines.join('\n');
}

/** Mermaid tolerates repeated declarations, but they clutter the source. */
const dedupeLines = (lines) => {
  const seen = new Set();
  return lines.filter((l) => {
    if (l.startsWith('```') || l.startsWith('flowchart')) return true;
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
};

/** App → panels → backing workflows → data sources. */
function appMermaid(appId) {
  const lines = ['```mermaid', 'flowchart LR'];
  const app = byId.get(appId);
  lines.push(`  ${mmId(appId)}["${mmLabel(app.label)}"]`);
  const wfs = new Set();
  for (const e of outs(appId)) {
    if (e.relation === 'contains' && e.context === 'panel') {
      const p = byId.get(e.target);
      if (!p) continue;
      lines.push(`  ${mmId(e.target)}("${mmLabel(p.label)}")`);
      lines.push(`  ${mmId(appId)} --> ${mmId(e.target)}`);
      for (const pe of outs(e.target)) {
        if (pe.relation === 'rendered_by') {
          const w = byId.get(pe.target);
          if (!w) continue;
          wfs.add(pe.target);
          lines.push(`  ${mmId(pe.target)}[["${mmLabel(w.label)}"]]`);
          lines.push(`  ${mmId(e.target)} --> ${mmId(pe.target)}`);
        }
        if (pe.relation === 'contains' && pe.context === 'sub-panel') {
          const sp = byId.get(pe.target);
          if (!sp) continue;
          lines.push(`  ${mmId(pe.target)}("${mmLabel(sp.label)}")`);
          lines.push(`  ${mmId(e.target)} --> ${mmId(pe.target)}`);
          for (const spe of outs(pe.target)) {
            if (spe.relation !== 'rendered_by') continue;
            const w = byId.get(spe.target);
            if (!w) continue;
            wfs.add(spe.target);
            lines.push(`  ${mmId(spe.target)}[["${mmLabel(w.label)}"]]`);
            lines.push(`  ${mmId(pe.target)} --> ${mmId(spe.target)}`);
          }
        }
      }
    }
    if (e.relation === 'navigates_to') {
      const t = byId.get(e.target);
      if (t) {
        lines.push(`  ${mmId(e.target)}["${mmLabel(t.label)}"]`);
        lines.push(`  ${mmId(appId)} -.->|navigates| ${mmId(e.target)}`);
      }
    }
  }
  // one hop further: what data each backing workflow touches
  for (const w of wfs) {
    for (const e of outs(w)) {
      if (e.relation !== 'depends_on_data') continue;
      const bo = byId.get(e.target);
      if (!bo) continue;
      lines.push(`  ${mmId(e.target)}[("${mmLabel(bo.label)}")]`);
      lines.push(`  ${mmId(w)} --> ${mmId(e.target)}`);
    }
  }
  lines.push('```');
  return dedupeLines(lines).join('\n');
}

// ---------------------------------------------------------------- note bodies

/** Human-facing wording for each relation, and which direction reads better. */
const REL_LABEL = {
  contains: 'Contains',
  exposes_agent: 'Agents (backing workflows)',
  rendered_by: 'Rendered by',
  summarized_by: 'Summary agent',
  subtitle_by: 'Subtitle agent',
  communicates_via: 'Communications agent',
  navigates_to: 'Navigates to',
  invokes_agent: 'Invokes agent',
  flows_to: 'Flows to',
  converges_to: 'Converges to',
  on_error_to: 'On error',
  reads_output_of: 'Reads output of',
  calls_bo_function: 'Calls BO function',
  uses_business_object: 'Uses business object',
  depends_on_data: 'Data sources',
  invokes_workflow: 'Invokes workflow',
  calls: 'Calls sub-workflow',
  uses_tool: 'Uses tool',
  uses_model: 'Model',
  governed_by: 'Governed by policy',
  in_family: 'Family',
  in_product: 'Product',
  belongs_to_family: 'Family',
  belongs_to: 'Business object',
  is_artifact_type: 'Artifact type',
  exposes_rest_resource: 'REST resource',
  calls_rest: 'REST endpoint',
  reads_app_context: 'Reads app context',
  routes_app_stage: 'Routes app stage',
  has_issue: 'Findings',
  backed_by: 'Backed by',
  references_prompt: 'Prompt references',
  prescribes_command: 'Prescribes commands',
  routes_artifact: 'Routes artifacts',
  targets_family: 'Targets family',
  delegates_to: 'Delegates to',
  documents_command: 'Documents commands',
  documents_artifact: 'Documents artifacts',
  see_also: 'See also',
  documents: 'Documents',
  operates_on: 'Operates on',
  in_group: 'Group',
  has_verb: 'Verb',
  nests: 'Nested pipeline',
};

const REL_INBOUND = {
  contains: 'Part of',
  exposes_agent: 'Exposed by app',
  rendered_by: 'Renders panel',
  flows_to: 'Reached from',
  reads_output_of: 'Output read by',
  calls_bo_function: 'Called by',
  depends_on_data: 'Used by workflow',
  invokes_workflow: 'Invoked by',
  calls: 'Called by',
  uses_tool: 'Used by',
  uses_model: 'Used by',
  in_family: 'Members',
  in_product: 'Members',
  belongs_to_family: 'Products',
  belongs_to: 'Functions',
  is_artifact_type: 'Instances',
  calls_rest: 'Called by',
  reads_app_context: 'Read by',
  routes_app_stage: 'Routed by',
  has_issue: 'Affected nodes',
  documents: 'Documented in',
  operates_on: 'Commands',
  in_group: 'Commands',
  has_verb: 'Commands',
  prescribes_command: 'Prescribed by',
  documents_command: 'Documented in',
  references_prompt: 'Referenced by',
  see_also: 'Referenced by',
  navigates_to: 'Reached from',
  backed_by: 'Backs',
  documents_artifact: 'Documented in',
  routes_artifact: 'Routed by',
  nests: 'Nested in',
  converges_to: 'Convergence from',
  on_error_to: 'Error handler for',
  invokes_agent: 'Invoked by action',
  summarized_by: 'Summarises',
  subtitle_by: 'Subtitle for',
  communicates_via: 'Communications for',
  uses_business_object: 'Used by',
  exposes_rest_resource: 'Exposed by',
  governed_by: 'Governs',
  delegates_to: 'Delegated from',
  targets_family: 'Targeted by',
};

/** Relations already shown by a Mermaid diagram — don't repeat as link lists. */
const DIAGRAMMED = new Set(['flows_to', 'converges_to', 'on_error_to', 'reads_output_of']);

function relationSections(id, { skip = new Set() } = {}) {
  const groups = new Map();
  for (const e of outs(id)) {
    if (skip.has(e.relation)) continue;
    const k = REL_LABEL[e.relation] ?? e.relation;
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k).add(link(e.target) + (e.context && e.context !== 'success' ? ` — *${e.context}*` : ''));
  }
  for (const e of incs(id)) {
    if (skip.has(e.relation)) continue;
    const k = REL_INBOUND[e.relation] ?? `${e.relation} (in)`;
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k).add(link(e.source));
  }
  const parts = [];
  for (const [heading, items] of groups) {
    const list = [...items];
    parts.push(`### ${heading}\n${list.map((s) => `- ${s}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

const fence = (lang, body) => '```' + lang + '\n' + body + '\n```';

const REPO_URL = 'https://github.com/oracle/fusion-ai-studio/blob/release-26C';

function sourceLine(n) {
  if (!n.source_file || n.source_file === '(derived)') return '';
  return `\n\n---\n**Source:** \`${n.source_file}\` · [view on GitHub](${REPO_URL}/${n.source_file})`;
}

function tagsFor(n) {
  const t = [`type/${n.type}`];
  if (n.family) t.push(`family/${n.family}`);
  if (n.product) t.push(`product/${n.product}`);
  if (n.nodeType) t.push(`node/${n.nodeType}`);
  if (n.group) t.push(`group/${String(n.group).replace(/[^a-z]+/gi, '-')}`);
  if (n.verb) t.push(`verb/${n.verb}`);
  if (n._stub) t.push('stub/platform-seeded');
  if (n.issues?.length) t.push('finding/has-issue');
  if (n.articulation) t.push('finding/cut-vertex');
  if (n.layerName) t.push(`layer/${String(n.layerName).replace(/[^a-z]+/gi, '-').toLowerCase()}`);
  if (n.community !== undefined) t.push(`community/C-${n.community}`);
  return t;
}

function noteFor(n) {
  const fm = frontmatter({
    title: n.label,
    type: n.type,
    code: n.code,
    nodeType: n.nodeType,
    workflow: n.workflow,
    family: n.family,
    product: n.product,
    status: n.status,
    architecture: n.architecture,
    pagePattern: n.pagePattern,
    operationType: n.operationType,
    toolType: n.toolType,
    verb: n.verb,
    group: n.group,
    nodeCount: n.nodeCount,
    agentCount: n.agentCount,
    aiAppsCompatible: n.aiAppsCompatible,
    seeded: n.seeded,
    platformSeeded: n._stub,
    source: n.source_file,
    layer: n.layerName,
    stackRole: n.stackRole,
    appExposed: n.appExposed,
    pagerank: n.pagerank,
    pagerankRank: n.pagerankRank,
    bridgeScore: n.bridgeScore,
    blastRadius: n.blastRadius,
    community: n.community,
    communitySize: n.communitySize,
    clustering: n.clustering,
    degree: n.degree,
    articulation: n.articulation,
    tags: tagsFor(n),
  });

  const parts = [fm, `# ${n.label}`];
  if (n.summary) parts.push(`> ${n.summary}`);

  if (n._stub) {
    parts.push(
      `> [!info] Referenced but not present in this repo\n> Resolved by the AI Studio platform at runtime (a seeded artifact), so there is no local file to open.`,
    );
  }
  if (n.issues?.length) {
    parts.push(
      `> [!warning] Findings\n${n.issues.map((i) => `> - ${i}`).join('\n')}`,
    );
  }
  if (n.articulation) {
    parts.push(
      `> [!danger] Structural single point of failure\n> Removing this node disconnects its component — nothing else bridges the two sides.`,
    );
  }
  if (n.pagerank !== undefined) {
    parts.push(
      `**Signals** — PageRank #${n.pagerankRank} · bridge score ${(n.bridgeScore ?? 0).toFixed(1)} · ` +
      `blast radius ${n.blastRadius ?? 0} · community C-${n.community} (${n.communitySize} members) · ` +
      `degree ${n.degree} (${n.inDegree} in / ${n.outDegree} out)`,
    );
  }

  const skip = new Set();

  if (n.type === 'workflow') {
    const mm = workflowMermaid(n.id);
    if (mm) {
      parts.push(`## Flow\nSolid = control flow, dotted = data dependency.\n\n${mm}`);
      for (const r of DIAGRAMMED) skip.add(r);
      skip.add('contains');
      // still list the member nodes, but as a compact table
      const rows = outs(n.id)
        .filter((e) => e.relation === 'contains')
        .map((e) => byId.get(e.target))
        .filter(Boolean)
        .map((m) => {
          const desc = m.summary && m.summary !== m.label ? m.summary : '';
          return `| ${m.nodeType} | ${link(m.id)} | ${desc.replace(/\|/g, '\\|').slice(0, 90)} |`;
        });
      if (rows.length) {
        parts.push(`## Nodes (${rows.length})\n| Type | Node | Description |\n| --- | --- | --- |\n${rows.join('\n')}`);
      }
    }
    if (n.triggers?.length) parts.push(`**Triggers:** ${n.triggers.join(', ')}`);
  }

  if (n.type === 'app') {
    parts.push(`## Architecture\n\n${appMermaid(n.id)}`);
  }

  if (n.type === 'workflowNode') {
    if (n.promptExcerpt) parts.push(`## Prompt\n${fence('text', n.promptExcerpt)}`);
    if (n.caseExpression) parts.push(`## Routing expression\n${fence('text', n.caseExpression)}`);
    if (n.sourceCodeExcerpt) {
      parts.push(`## Code${n.sourceCodeLines ? ` (${n.sourceCodeLines} lines)` : ''}\n${fence('javascript', n.sourceCodeExcerpt)}`);
    }
    if (n.inputNames?.length) parts.push(`**Inputs:** ${n.inputNames.map((i) => `\`${i}\``).join(', ')}`);
    const mm = incs(n.id).find((e) => e.relation === 'contains');
    if (mm) parts.push(`**Workflow:** ${link(mm.source)}`);
    // control/data flow reads better as a diagram on the workflow note
    for (const r of ['converges_to']) skip.add(r);
  }

  if (n.type === 'boFunction') {
    if (n.resourcePath) parts.push(`## REST\n\`${n.operationType ?? 'GET'} ${n.resourcePath}\``);
    if (n.params?.length) parts.push(`**Parameters:** ${n.params.map((p) => `\`${p}\``).join(', ')}`);
  }

  if (n.type === 'cliCommand') {
    parts.push(
      `## Usage\n${fence('bash', `node .agents/skills/aistudio/scripts/aistudio.js ${n.code} --help`)}`,
    );
  }

  if (n.type === 'businessObject' && n.restResourcePath) {
    parts.push(`**REST resource:** \`${n.restResourcePath}\`  \n**Source:** ${n.objectSource ?? '—'}`);
  }

  const rels = relationSections(n.id, { skip });
  if (rels) parts.push(`## Relationships\n\n${rels}`);

  // skill notes absorb their section list
  if (n.type === 'skill') {
    const secs = outs(n.id)
      .filter((e) => e.relation === 'contains' && e.context === 'section')
      .map((e) => byId.get(e.target)?.label)
      .filter(Boolean);
    if (secs.length) parts.push(`## Sections in SKILL.md\n${secs.map((s) => `- ${s}`).join('\n')}`);
  }

  return parts.join('\n\n') + sourceLine(n);
}

// ---------------------------------------------------------------- write

if (fs.existsSync(VAULT)) {
  // only ever clear generated content; never touch .obsidian settings
  for (const e of fs.readdirSync(VAULT)) {
    if (e === '.obsidian') continue;
    fs.rmSync(path.join(VAULT, e), { recursive: true, force: true });
  }
}
fs.mkdirSync(VAULT, { recursive: true });

let written = 0;
for (const n of graph.nodes) {
  const p = notePath.get(n.id);
  if (!p) continue;
  const file = path.join(VAULT, `${p}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, noteFor(n));
  written++;
}

// ---------------------------------------------------------------- maps of content

const byType = (t) => graph.nodes.filter((n) => n.type === t);
const sortByLabel = (a, b) => String(a.label).localeCompare(String(b.label));

function mocTable(list, cols) {
  const head = `| ${cols.map((c) => c[0]).join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |`;
  const rows = list.map((n) => `| ${cols.map((c) => c[1](n)).join(' | ')} |`);
  return `${head}\n${rows.join('\n')}`;
}

const clean = (s, n = 110) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, n);

fs.mkdirSync(path.join(VAULT, 'Maps'), { recursive: true });

const maps = {
  'Apps': mocTable(byType('app').sort(sortByLabel), [
    ['App', (n) => link(n.id)],
    ['Code', (n) => `\`${n.code ?? ''}\``],
    ['Pattern', (n) => n.pagePattern ?? ''],
    ['Agents', (n) => n.agentCount ?? ''],
    ['Description', (n) => clean(n.summary)],
  ]),
  'Workflows': mocTable(byType('workflow').sort(sortByLabel), [
    ['Workflow', (n) => link(n.id)],
    ['Family', (n) => (n.family ? link(`family:${n.family}`, n.family) : '')],
    ['Product', (n) => (n.product ? link(`product:${n.product}`, n.product) : '')],
    ['Nodes', (n) => n.nodeCount ?? ''],
    ['App-compatible', (n) => (n.aiAppsCompatible ? 'yes' : '')],
    ['Description', (n) => clean(n.summary, 90)],
  ]),
  'Business Objects': mocTable(byType('businessObject').sort(sortByLabel), [
    ['Business Object', (n) => link(n.id)],
    ['Product', (n) => (n.product ? link(`product:${n.product}`, n.product) : '')],
    ['Source', (n) => n.objectSource ?? ''],
    ['REST resource', (n) => (n.restResourcePath ? `\`${n.restResourcePath}\`` : '')],
    ['Description', (n) => clean(n.summary, 90)],
  ]),
  'Tools and Deeplinks': [
    '## Tools',
    mocTable(byType('tool').sort(sortByLabel), [
      ['Tool', (n) => link(n.id)],
      ['Type', (n) => n.toolType ?? ''],
      ['Namespace', (n) => n.namespace ?? ''],
      ['Description', (n) => clean(n.summary)],
    ]),
    '## Deeplinks',
    mocTable(byType('deeplink').sort(sortByLabel), [
      ['Deeplink', (n) => link(n.id)],
      ['Usage', (n) => n.usageType ?? ''],
      ['Description', (n) => clean(n.summary)],
    ]),
  ].join('\n\n'),
  'Skills and Prompts': [
    '## Skills',
    mocTable(byType('skill').sort(sortByLabel), [
      ['Skill', (n) => link(n.id)],
      ['Lines', (n) => n.lines ?? ''],
      ['Description', (n) => clean(n.summary, 200)],
    ]),
    '## Prompt references',
    mocTable(byType('promptReference').sort(sortByLabel), [
      ['Reference', (n) => link(n.id)],
      ['Lines', (n) => n.lines ?? ''],
      ['Purpose', (n) => clean(n.summary, 140)],
    ]),
  ].join('\n\n'),
  'CLI Commands': (() => {
    const groups = new Map();
    for (const c of byType('cliCommand').sort(sortByLabel)) {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c);
    }
    return [...groups]
      .sort((a, b) => b[1].length - a[1].length)
      .map(
        ([g, list]) =>
          `## ${g} (${list.length})\n` +
          mocTable(list, [
            ['Command', (n) => link(n.id)],
            ['Verb', (n) => n.verb ?? ''],
            ['Description', (n) => clean(n.summary, 140)],
          ]),
      )
      .join('\n\n');
  })(),
  'Data Flow': (() => {
    // which workflows touch which business objects, and via which function
    const rows = [];
    for (const e of graph.edges) {
      if (e.relation !== 'calls_bo_function') continue;
      const node = byId.get(e.source);
      const fn = byId.get(e.target);
      if (!node || !fn) continue;
      rows.push(
        `| ${link(`wf:${node.workflow}`, node.workflow)} | ${link(node.id)} | ${link(fn.id)} | ${
          fn.businessObject ? link(`bo:${fn.businessObject}`, fn.businessObject) : ''
        } | ${fn.operationType ?? ''} |`,
      );
    }
    return (
      `Every BO-backed data fetch in the corpus (${rows.length}).\n\n` +
      `| Workflow | Node | Function | Business Object | Op |\n| --- | --- | --- | --- | --- |\n${rows.sort().join('\n')}`
    );
  })(),
  'Findings': (() => {
    const flagged = graph.nodes.filter((n) => n.issues?.length);
    if (!flagged.length) return 'No findings.';
    return (
      `Artifact-level findings surfaced during extraction (${flagged.length} nodes).\n\n` +
      mocTable(flagged.sort(sortByLabel), [
        ['Node', (n) => link(n.id)],
        ['Workflow', (n) => (n.workflow ? link(`wf:${n.workflow}`, n.workflow) : '')],
        ['Type', (n) => n.nodeType ?? ''],
        ['Findings', (n) => clean(n.issues.join('; '), 160)],
      ]) +
      `\n\n## Referenced but not in this repo\n` +
      mocTable(graph.nodes.filter((n) => n._stub).sort(sortByLabel), [
        ['Artifact', (n) => link(n.id)],
        ['Type', (n) => n.type],
        ['Code', (n) => `\`${n.code ?? ''}\``],
      ])
    );
  })(),
  'Architecture Stack': (() => {
    const ORDER = [
      [5, 'Business outcomes', 'the result'],
      [4, 'Agentic applications', 'the product'],
      [3, 'Agent teams', 'supervisor + workflow'],
      [2, 'Agents', 'compose tools'],
      [1, 'Tools', 'used by agents'],
      [0, 'Agent internals', 'workflow steps'],
      [-1, 'Authoring & governance', 'skills, prompts, CLI, policy'],
    ];
    // one element per paragraph: the whole list is joined with blank lines, so a
    // multi-line fence has to arrive as a single string
    const diagram = [
      '```mermaid',
      'flowchart TD',
      '  BO["Business outcomes · the result"] --> AA["Agentic applications · the product"]',
      '  AA --> AT["Agent teams · supervisor + workflow"]',
      '  AT --> AG["Agents · compose tools"]',
      '  AG --> TL["Tools · used by agents"]',
      '  TL --> AI["Agent internals · workflow steps"]',
      '  classDef top fill:#f3e8fd,stroke:#a142f4',
      '  classDef mid fill:#e8f0fe,stroke:#4285f4',
      '  classDef low fill:#e6f4ea,stroke:#34a853',
      '  class BO,AA top',
      '  class AT,AG mid',
      '  class TL,AI low',
      '```',
    ].join('\n');
    const out = [
      'The Oracle AI Agent Studio hierarchy, top down, with every artifact in this repo placed on it.',
      diagram,
      'A workflow is placed on **Agent teams** when an app exposes it as an agent or when it',
      'invokes sub-workflows — i.e. it supervises other agents. Every other workflow is an',
      '**Agent**. That distinction is derived from edges, because the `.wf` format does not',
      'record it.',
    ];
    for (const [layer, name, note] of ORDER) {
      const list = graph.nodes.filter((x) => x.layer === layer);
      if (!list.length) continue;
      const kinds = [...new Set(list.map((x) => x.type))].join(', ');
      out.push(`## ${name}`, `*${note}* — ${list.length} artifacts (${kinds})`);
      // list the interesting ones rather than 1,679 workflow nodes
      const show = layer === 0
        ? list.filter((x) => x.issues?.length || x.articulation).sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0)).slice(0, 20)
        : [...list].sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0)).slice(0, 40);
      if (layer === 0) out.push('Only the flagged ones are listed; the rest live under each workflow.');
      if (show.length) {
        out.push(mocTable(show, [
          ['Artifact', (x) => link(x.id)],
          ['Kind', (x) => x.type],
          ['Role', (x) => x.stackRole ?? ''],
          ['Family', (x) => x.family ?? ''],
          ['PageRank', (x) => `#${x.pagerankRank ?? '—'}`],
          ['Blast', (x) => x.blastRadius ?? ''],
        ]));
      }
    }
    return out.join('\n\n');
  })(),
  'Hubs and Bottlenecks': (() => {
    const ARTIFACTS = new Set(['app', 'workflow', 'workflowNode', 'businessObject', 'boFunction', 'tool', 'deeplink', 'skill', 'promptReference', 'cliCommand']);
    const top = (key, count, filter = () => true) =>
      graph.nodes.filter(filter).sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, count);
    const NAME = [['Node', (x) => link(x.id)], ['Kind', (x) => x.type], ['Where', (x) => x.workflow ?? x.family ?? '—']];
    return [
      'Centrality over the typed dependency graph. Classification edges (family, artifact type, model config) are excluded — left in, they connect every workflow to every other and the numbers measure the taxonomy instead of the architecture.',
      '## Architectural hubs — PageRank',
      'What the corpus points at. A node scores highly only when the things pointing at it are themselves well connected.',
      mocTable(top('pagerank', 20, (x) => ARTIFACTS.has(x.type)), [...NAME,
        ['PageRank', (x) => x.pagerank], ['Rank', (x) => `#${x.pagerankRank}`], ['Blast radius', (x) => x.blastRadius]]),
      '## Bridges — highest bridge score',
      'Shortest paths across the corpus funnel through these.',
      mocTable(top('bridgeScore', 20), [...NAME, ['Bridge', (x) => (x.bridgeScore ?? 0).toFixed(1)], ['Degree', (x) => x.degree]]),
      `## Structural single points of failure`,
      `Removing one of these disconnects its component. ${graph.nodes.filter((x) => x.articulation).length} of ${graph.nodes.length} nodes qualify.`,
      mocTable(top('bridgeScore', 30, (x) => x.articulation), [...NAME,
        ['Bridge', (x) => (x.bridgeScore ?? 0).toFixed(1)], ['Blast radius', (x) => x.blastRadius], ['Degree', (x) => x.degree]]),
      '## Widest blast radius',
      'How many artifacts can transitively reach this one, i.e. how much depends on it.',
      mocTable(top('blastRadius', 20, (x) => ARTIFACTS.has(x.type)), [...NAME,
        ['Blast radius', (x) => x.blastRadius], ['PageRank', (x) => `#${x.pagerankRank}`]]),
      '## Business objects by blast radius',
      'The data layer, ordered by how much of the corpus depends on each source.',
      mocTable(top('blastRadius', 25, (x) => x.type === 'businessObject'), [
        ['Business object', (x) => link(x.id)], ['Product', (x) => x.product ?? '—'],
        ['Blast radius', (x) => x.blastRadius], ['Functions', (x) => x.outDegree]]),
    ].join('\n\n');
  })(),
  'Taxonomy': [
    '## Families',
    mocTable(byType('family').sort(sortByLabel), [
      ['Family', (n) => link(n.id)],
      ['Products', (n) => String(incs(n.id).filter((e) => e.relation === 'belongs_to_family').length)],
    ]),
    '## Products',
    mocTable(byType('product').sort(sortByLabel), [
      ['Product', (n) => link(n.id)],
      ['Workflows', (n) => String(incs(n.id).filter((e) => e.relation === 'in_product').length)],
    ]),
    '## Model configurations',
    mocTable(byType('modelConfiguration').sort(sortByLabel), [
      ['Model config', (n) => link(n.id)],
      ['Model', (n) => n.modelName ?? n.model ?? ''],
      ['Used by', (n) => String(incs(n.id).filter((e) => e.relation === 'uses_model').length)],
    ]),
    '## Artifact types',
    mocTable(byType('artifactType').sort(sortByLabel), [
      ['Artifact type', (n) => link(n.id)],
      ['Instances', (n) => String(incs(n.id).filter((e) => e.relation === 'is_artifact_type').length)],
      ['Commands', (n) => String(incs(n.id).filter((e) => e.relation === 'operates_on').length)],
    ]),
  ].join('\n\n'),
};

for (const [name, body] of Object.entries(maps)) {
  fs.writeFileSync(
    path.join(VAULT, 'Maps', `${name}.md`),
    `${frontmatter({ title: name, type: 'map', tags: ['type/map'] })}\n\n# ${name}\n\n${body}\n`,
  );
  written++;
}

// ---------------------------------------------------------------- home note

const counts = {};
for (const n of graph.nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;

const home = `${frontmatter({ title: 'Fusion AI Studio Knowledge Graph', type: 'home', tags: ['type/home'] })}

# Fusion AI Studio Knowledge Graph

A navigable graph of the [oracle/fusion-ai-studio](https://github.com/oracle/fusion-ai-studio) release-26C corpus:
every agentic app, workflow, workflow node, business object, tool, skill, prompt reference and CLI command,
plus the control-flow and data-flow edges that connect them.

**${graph.nodes.length} notes · ${graph.edges.length} relationships**

## Start here

| Map | What it answers |
| --- | --- |
| [[Maps/Apps]] | Which agentic apps exist, and which agents each surfaces |
| [[Maps/Workflows]] | All ${counts.workflow ?? 0} workflows by family and product |
| [[Maps/Data Flow]] | Every BO-backed fetch: workflow → node → function → business object |
| [[Maps/Business Objects]] | Data sources and the REST resources behind them |
| [[Maps/CLI Commands]] | All ${counts.cliCommand ?? 0} \`aistudio\` commands, grouped by purpose |
| [[Maps/Skills and Prompts]] | Skills and the prompt references they load |
| [[Maps/Tools and Deeplinks]] | Tools and their backing deeplinks |
| [[Maps/Taxonomy]] | Families, products, model configurations, artifact types |
| [[Maps/Architecture Stack]] | The Agent Studio hierarchy: outcomes → apps → teams → agents → tools |
| [[Maps/Hubs and Bottlenecks]] | PageRank hubs, bridges, cut vertices, blast radius |
| [[Maps/Findings]] | Unwired branches, unresolved references, platform-seeded artifacts |

## How to search this vault

- **By name** — \`Ctrl/Cmd-O\` quick switcher.
- **Full text across every prompt and code node** — \`Ctrl/Cmd-Shift-F\`. Node notes embed
  their LLM prompts, routing expressions and JS source, so a search for \`RiskOfLoss\` or
  \`scrubString\` lands on the exact node.
- **By facet** — search \`tag:#node/LLM\`, \`tag:#family/HCM\`, \`tag:#verb/mutate\`,
  \`tag:#finding/cut-vertex\`, \`tag:#community/C-5\`, \`tag:#layer/agent-teams\`.
- **By metric** — sort on the \`pagerank\`, \`bridgeScore\` or \`blastRadius\` properties, or
  Dataview: \`TABLE pagerank, blastRadius FROM #type/workflow SORT pagerank DESC\`.
- **Structurally** — open the graph view (\`Ctrl/Cmd-G\`) and filter, e.g. \`path:Workflows\`.
- **By property** — the Properties panel exposes \`family\`, \`product\`, \`nodeType\`,
  \`aiAppsCompatible\` and friends for sorting and Dataview queries.

## Node types

${Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .map(([t, c]) => `- **${t}** — ${c}`)
  .join('\n')}

---
Generated by \`tools/build-obsidian-vault.mjs\` from \`graph/fusion-graph.json\`. Regenerate with \`./run.sh\`.
Do not hand-edit: the vault is rebuilt from the graph.
`;

fs.writeFileSync(path.join(VAULT, 'Home.md'), home);
written++;

// ---------------------------------------------------------------- .obsidian config

const OB = path.join(VAULT, '.obsidian');
fs.mkdirSync(OB, { recursive: true });

const colorGroup = (query, color) => ({ query, color: { a: 1, rgb: color } });
fs.writeFileSync(
  path.join(OB, 'graph.json'),
  JSON.stringify(
    {
      collapse_filter: false,
      search: '',
      showTags: false,
      showAttachments: false,
      hideUnresolved: true,
      showOrphans: false,
      collapse_color: false,
      colorGroups: [
        colorGroup('path:Apps', 0xa142f4),
        colorGroup('path:Workflows/', 0x4285f4),
        colorGroup('path:"Workflow Nodes"', 0x7baaf7),
        colorGroup('path:"Business Objects"', 0x34a853),
        colorGroup('path:"BO Functions"', 0x81c995),
        colorGroup('path:Tools OR path:Deeplinks', 0xf9ab00),
        colorGroup('path:Skills OR path:"Prompt References"', 0xea4335),
        colorGroup('path:"CLI Commands"', 0xff8bcb),
        colorGroup('path:Taxonomy OR path:Concepts', 0x9aa0a6),
        colorGroup('path:Findings', 0xd93025),
      ],
      collapse_display: false,
      showArrow: true,
      textFadeMultiplier: -0.6,
      nodeSizeMultiplier: 1.1,
      lineSizeMultiplier: 0.6,
      collapse_forces: false,
      centerStrength: 0.4,
      repelStrength: 12,
      linkStrength: 0.6,
      linkDistance: 180,
      scale: 0.35,
      close: false,
    },
    null,
    2,
  ),
);

fs.writeFileSync(
  path.join(OB, 'app.json'),
  JSON.stringify(
    {
      attachmentFolderPath: 'Attachments',
      alwaysUpdateLinks: true,
      newLinkFormat: 'absolute',
      useMarkdownLinks: false,
      strictLineBreaks: false,
      showLineNumber: false,
      readableLineLength: false,
      defaultViewMode: 'preview',
    },
    null,
    2,
  ),
);

fs.writeFileSync(
  path.join(OB, 'appearance.json'),
  JSON.stringify({ accentColor: '#c74634', theme: 'system' }, null, 2),
);

fs.writeFileSync(
  path.join(OB, 'core-plugins.json'),
  JSON.stringify(
    [
      'file-explorer',
      'global-search',
      'switcher',
      'graph',
      'backlink',
      'outgoing-link',
      'tag-pane',
      'properties',
      'page-preview',
      'outline',
      'word-count',
      'bookmarks',
      'random-note',
      'file-recovery',
    ],
    null,
    2,
  ),
);

console.log(`[vault] ${written} notes -> ${VAULT}`);
console.log(`[vault] open in Obsidian:  Open folder as vault -> ${VAULT}`);
const folders = fs
  .readdirSync(VAULT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '.obsidian')
  .map((d) => {
    let c = 0;
    const stack = [path.join(VAULT, d.name)];
    while (stack.length) {
      for (const e of fs.readdirSync(stack.pop(), { withFileTypes: true })) {
        if (e.isDirectory()) stack.push(path.join(VAULT, d.name, e.name));
        else c++;
      }
    }
    return `  ${String(c).padStart(5)}  ${d.name}`;
  });
console.log(folders.join('\n'));
