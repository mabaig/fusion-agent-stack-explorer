# Fusion AI Studio Knowledge Graph

A queryable, navigable, visual map of the [oracle/fusion-ai-studio](https://github.com/oracle/fusion-ai-studio)
`release-26C` corpus — built with [Graphify](https://github.com/safishamsi/graphify) and
[Obsidian](https://obsidian.md), plus **Fusion AI Agent Stack Explorer**, a purpose-built explorer.

Everything here is generated and reproducible. Your clone, the source tree and the rest of
the workspace are read-only inputs; nothing outside this folder is written to.

```
./run.sh --sync      # fetch the latest upstream branch, then rebuild everything
./run.sh             # rebuild from the source already in .source/
```

---

## What you get

| Artifact | Open with | What it's for |
| --- | --- | --- |
| `app/index.html` | any browser | **Fusion AI Agent Stack Explorer** — focus any artifact, walk its neighbourhood in six layouts, read its centrality signals; plus a Data Lab with a sortable table, CSV export, path finder and impact analysis |
| `app/agent-stack-explorer.html` | any browser | the same app as one self-contained file, for sharing |
| `vault/` | Obsidian → *Open folder as vault* | 2,467 linked notes with Mermaid flow diagrams, metric properties and Obsidian's native graph view |
| `graph/METRICS.md` | editor | hubs, bridges, cut vertices and blast radius, ranked |
| `graph/fusion-graph.json` | anything | the canonical graph — 2,748 nodes, 8,996 edges |
| `graphify-out/graph.html` | any browser | Graphify's vis.js graph, coloured by community |
| `graphify-out/GRAPH_TREE.html` | any browser | Graphify's collapsible D3 hierarchy |
| `graphify-out/fusion-knowledge-graph-callflow.html` | any browser | Graphify's Mermaid call-flow sections |
| `graphify-out/GRAPH_REPORT.md` | editor | community breakdown and surprising connections |

## The questions this answers

1. **"Which skill, prompt reference or CLI command covers X?"** — 3 skills, 62 prompt
   references and 290 `aistudio` commands are first-class nodes, cross-linked to the
   artifact types they operate on.
2. **"How does this app actually get its data?"** — app → panel → agent workflow → workflow
   node → BO function → REST resource is a real edge chain. Follow it, or ask for the path.
3. **"What breaks if I change this business object?"** — Impact mode reverse-traverses and
   groups every dependent; `blastRadius` gives the exact count.
4. **"Where is that prompt / that bit of JS?"** — every LLM prompt, routing expression and
   `CODE` node body is indexed as searchable text.
5. **"What is actually load-bearing here?"** — PageRank, betweenness, Louvain communities,
   articulation points and blast radius, computed over the typed dependency graph.

---

## Three tools, three layers

They are often confused because all three draw a force-directed graph. They are not
alternatives:

| | What it is | Role here |
| --- | --- | --- |
| **Graphify** | A program that *produces* a graph — parsers → `graph.json`, plus a query CLI | The extraction and query engine |
| **Obsidian** | A program that *displays* markdown. Extracts nothing | The human reading surface |
| **OKF** | Not a program — Google Cloud's [Open Knowledge *Format*](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) spec: markdown + YAML frontmatter | A portable contract; the vault is close to conformant already |

Generic vault-graph tools derive edges from markdown *proximity* — shared tags, same folder,
similar mtime. That is the wrong instrument for this corpus: the vault is batch-generated, so
every note shares one mtime, 1,679 notes sit in one folder, and 1,679 share one tag.
Those heuristics would bury 8,996 real typed edges under ~10^6 derived ones, and
centrality would then measure folder layout. Hence: metrics run on the typed graph.

---

## The Agent Studio hierarchy

Every node carries a `layer`, placing it on Oracle AI Agent Studio's stack. This is the
primary organising principle in both surfaces — the explorer opens in **Agent Studio stack**
layout, one band per layer, outcomes on top.

| Layer | Count | What sits here |
| --- | --- | --- |
| **Business outcomes** — the result | 28 | `product`, `family` (the closest artifact in the repo; there is no explicit outcome object) |
| **Agentic applications** — the product | 62 | `app`, panels, sub-panels, actions |
| **Agent teams** — supervisor + workflow | 28 | workflows an app exposes as an agent, or that invoke sub-workflows |
| **Agents** — compose tools | 81 | every other workflow |
| **Tools** — used by agents | 376 | `tool`, `businessObject`, `boFunction`, `deeplink`, REST resources |
| **Agent internals** — workflow steps | 1,679 | `workflowNode` — the inside of an agent, not a layer of the stack |
| **Authoring & governance** | 494 | skills, prompt references, CLI commands, policies, model configs |

The team/agent split is **derived from edges, not from a field** — the `.wf` format does not
record it. A workflow is a team when an app exposes it as an agent (`exposes_agent`,
`rendered_by`, `summarized_by`, …) or when it invokes sub-workflows (`calls`,
`invokes_workflow`), i.e. it supervises other agents. 15 workflows are both app-exposed and
supervising; 5 supervise only; 8 are app-exposed only.

Business outcomes are the honest weak point: the repo has no outcome artifact, so `product`
and `family` stand in for it. Treat that band as "business area", not as a measured outcome.

## Why a custom extractor

Graphify's AST extractors cover 20-odd languages plus Markdown and PDF, but AI Studio's
artifacts are none of those — `.app`, `.wf`, `.bo`, `.tool` and `.dl` are Oracle-specific JSON
whose meaning lives in fields like `metadata.businessObjectCode`, `outcomes`, and
`{{$context.$nodes.X.$output}}` template expressions.

`tools/extract-fusion-graph.mjs` reads those natively and **emits Graphify's own `graph.json`
schema**, so the domain is modelled properly and Graphify's query surface still works:

```bash
G=.venv-graphify/bin/graphify

$G query   "which workflows read purchasing data"
$G path    "Succession Readiness Workspace" "Succession Details Lookup"
$G explain "Intent Router"
$G affected "HCM GHR Worker Search" --depth 3
$G god-nodes --top 15
$G benchmark graphify-out/graph.json
```

## What's in the graph

**Nodes (2,748)**

| Count | Type | Source |
| --- | --- | --- |
| 1,679 | `workflowNode` | every node of every `.wf` pipeline, incl. nested LOOP/WHILE |
| 290 | `cliCommand` | `aistudio --help`, grouped by purpose and verb |
| 190 | `boFunction` | the REST-backed functions each `.bo` exposes |
| 109 | `workflow` | `.wf` files (plus any referenced-only) |
| 108 | `restResource` | distinct Fusion REST resource paths |
| 74 | `businessObject` | `.bo` files |
| 62 | `promptReference` | `.agents/skills/**/references/**/*.md` |
| 52 | `docSection` | `##` headings inside each SKILL.md |
| 43 | `doc` | READMEs and how-to guides |
| 29 | `appAction` | app actions and their navigation targets |
| 24 | `product` | derived taxonomy |
| 20 | `appPanel` | agent containers |
| 14 | `artifactType` | the skill routing table |
| 10 | `commandGroup` | derived from command names |
| 8 | `appSubPanel` | additional panels |
| 8 | `commandVerb` | do-/get-/list-/run-/validate- |
| 7 | `appContextKey` | `$app.$Ora*` keys nodes read |
| 5 | `app` | `.app` agentic apps (plus referenced-only) |
| 4 | `family` | HCM, SCM, FIN, PRC |
| 3 | `tool` | `.tool` files |
| 3 | `skill` | `SKILL.md` files |
| 2 | `modelConfiguration` | model configs referenced by workflows |
| 2 | `appStage` | InitDisplay / Query / … |
| 1 | `deeplink` | `.dl` files |
| 1 | `issue` | extraction findings |

**Edges (8,996)** — the load-bearing ones:

| Relation | Count | Meaning |
| --- | --- | --- |
| `flows_to` | 1,807 | control flow, labelled with the outcome that takes that branch |
| `reads_output_of` | 1,185 | **data flow**, parsed from `{{$context.$nodes.X.$output}}` |
| `calls_bo_function` | 296 | a `BO_FUNCTION` node → the exact function it invokes |
| `converges_to` / `on_error_to` | 276 / 122 | branch convergence and error handlers |
| `depends_on_data` | 174 | workflow → business object, rolled up |
| `calls_rest` | 179 | BO function → REST endpoint |
| `reads_app_context` | 144 | node → `$app.$OraMessageHint` and friends |
| `invokes_workflow` | 39 | sub-workflow calls |
| `uses_tool` | 25 | workflow node → tool |
| `exposes_agent` | 21 | app → backing agent workflow |
| `has_issue` | 48 | see Findings |

## Metrics

`tools/compute-graph-metrics.mjs` writes these onto every node, and both the explorer and the
vault read them. Full rankings in `graph/METRICS.md`.

| Metric | Meaning |
| --- | --- |
| `pagerank`, `pagerankRank` | architectural importance — high when the things pointing at it are themselves well connected |
| `betweenness`, `bridgeScore` | bridge-ness (Brandes, undirected); `bridgeScore` is the percentile |
| `articulation` | removing it disconnects its component: **103 of 2,748** nodes qualify |
| `blastRadius` | exact count of artifacts that can transitively reach it |
| `community`, `communitySize` | Louvain communities — **206** of them, modularity **0.914507** |
| `componentId` | connected component (179 of them) |
| `clustering` | local clustering coefficient |
| `degree`, `inDegree`, `outDegree` | over all typed edges |

**Centrality runs on the dependency subgraph** (7,182 directed edges),
with 1,814 classification edges excluded. Those edges — `in_family`,
`is_artifact_type`, `uses_model` — attach many artifacts to one shared label and create
artificial 2-hop shortcuts. Left in, `artifactType:.wf` scored 0.39 betweenness, five times
the highest real workflow, purely because every workflow hangs off it. Degree metrics still
count all typed edges, where they are simply descriptive. `--include-classification`
computes the other way if you want to compare.

A note on reading PageRank: agentic **apps score low** (5 of them sit near the bottom).
That is correct, not a bug — apps are entry points with no inbound dependencies, so rank
flows away from them. Judge apps by blast radius and bridge score instead.

## Findings surfaced along the way

Extraction is strict: an unresolvable reference becomes a **finding**, not a silently dropped
edge. See `vault/Maps/Findings.md`, or filter the Data Lab to *has findings*.

- **48 unwired branches** — `SWITCH`/`CONDITION` outcomes with no target, so the branch
  dead-ends. Most are app-stage names on an `$OraMessageHint` router (`Query`, `initDisplay2`,
  `InitActions`, `AdditionalContent`, `Summary`), which reads as stages not yet implemented.
  A few look like leftovers: `dummy`, `New outcome 1`, bare `true`/`false`/`success`.
- **0 duplicate node entries** — the same node code listed twice in one `pipelineNodes`
  array. Harmless at runtime, worth knowing when diffing.
- **20 artifacts referenced but absent** — `ORA_USER_SESSION_TOOL`, `ORA_ASSIGNED_JOURNEY_TASK_LINK`, `ORA_PRC_SSP_GETATTACHMENT`, `get_document_for_processing`, `ORA_SCM_COSTMANAGE_INVENTORYVALUATIONCOMPARISONADVISOR`, ….
  Mostly platform-seeded. One exception worth a look: a reference to
  `SUCCESSION_OVERVIEW_ADVISOR` without the `XX_` prefix every other reference uses.

---

## Fusion AI Agent Stack Explorer

Open `app/index.html`. `⌘K` searches everything — names, codes, prompts, JS source.

**Graph tab**

- **Focus panel (left)** — PageRank rank, degree, community, bridge score, then a plain-language
  read of what those numbers mean for this node, and which neighbour to open next.
  *Community pressure* shows how the visible slice clusters.
- **Canvas (centre)** — six layouts. **Agent Studio stack** is the default and the one that
  explains the corpus: a band per layer, captioned, with node colour following the layer.
  **Layered** is the one to reach for on a single workflow: levels
  follow edge direction, so a pipeline reads left to right instead of curling into a ball.
  Force, radial, concentric-by-community and ranked-grid cover the rest. Edges are labelled
  with the real relation and branch outcome; dashed = data flow, solid violet = control flow.
  Cut vertices get a red rim. Hover any node for a readout; drag to pan, scroll to zoom,
  click to re-focus.
- **Right panel** — *Node* (properties, signals, prompt/code, source link), *Neighbors*
  (grouped by relation), *Bridges* and *Hubs* (ranked within the visible slice).
- **Edge legend (bottom)** — every relation with corpus and visible counts; click to toggle.
  Classification edges start hidden; *All on* reveals them.

**Data Lab tab** — the whole corpus as a sortable table with every metric, filters for
**layer**, kind, family, articulation points and findings, CSV export, plus the path finder
and impact analysis.

Keys: `⌘K` search · `g` graph · `d` data lab · `↑↓/↵` in the palette.

## Obsidian vault

Obsidian → *Open folder as vault* → `vault/`. Start at `Home.md`.

- `Maps/` — one Map-of-Content per dimension: Apps, Workflows, Data Flow, Business Objects,
  CLI Commands, Skills and Prompts, Tools and Deeplinks, **Architecture Stack**,
  **Hubs and Bottlenecks**, Taxonomy, Findings.
- Every workflow note carries a **Mermaid diagram** of its control and data flow, coloured by
  node role; every app note an app → panel → agent → business-object diagram.
- Node notes embed their LLM prompt, routing expression and JS source, so `⌘⇧F` searches real
  content, not just names.
- Frontmatter exposes `pagerank`, `bridgeScore`, `blastRadius`, `community`, `family`,
  `nodeType` and more to the Properties panel and Dataview:
  `TABLE pagerank, blastRadius FROM #type/workflow SORT pagerank DESC`
- Facet tags: `#type/…`, `#family/…`, `#node/LLM`, `#verb/mutate`, `#community/C-5`,
  `#finding/cut-vertex`.

Structural `START`/`END`/`ADD` nodes appear in the diagrams but get no note of their own,
so the vault holds fewer notes than the graph holds nodes.

The vault is regenerated wholesale, so **don't hand-edit it**. Your `.obsidian/` settings are
preserved across rebuilds; note bodies are not.

---

## Layout

```
fusion-knowledge-graph/
├── run.sh                        sync + rebuild everything
├── tools/
│   ├── extract-fusion-graph.mjs  .app/.wf/.bo/.tool/.dl + skills + CLI + docs -> graph.json
│   ├── compute-graph-metrics.mjs pagerank, betweenness, louvain, components, blast radius
│   ├── build-obsidian-vault.mjs  graph.json -> Obsidian vault
│   └── build-search-app.mjs      graph.json -> app/data.js (+ --bundle)
├── graph/fusion-graph.json       canonical graph (source of truth)
├── graph/METRICS.md              ranked hubs, bridges, cut vertices, blast radius
├── graphify-out/                 graphify's clustered view, visualisations, report
├── vault/                        the Obsidian vault
├── app/                          Fusion AI Agent Stack Explorer (index.html + app.js + app.css + data.js)
├── data/cli-help.txt             captured `aistudio --help`
├── .source/fusion-ai-studio/     upstream tree exported by --sync (gitignored)
└── .venv-graphify/               isolated graphify install, not global
```

`graph/fusion-graph.json` is authoritative. `graphify-out/graph.json` is Graphify's *view* of
it — its loader collapses a few parallel edges that differ only by relation.

## Staying current

`./run.sh --sync` fetches and rebuilds. It uses `git archive` to export the upstream tree into
`.source/`, so **your clone is never checked out, reset or modified** — it stays on whatever
branch and commit you left it on.

Upstream restructured in August 2026 and the tooling follows it by discovery, not by
hardcoded paths:

- the default branch is now **`release-26C`**, not `main` (`main-legacy` holds the old history)
- the `release-26C/` path prefix was dropped; everything moved to the repo root
- skills are now checked in at **`.agents/skills/`** as real files; the bundled
  `aistudio/bin/aistudio` copy and the skill zips are gone
- a new **`aiapps/prc/purchasing`** pillar appeared (10 artifacts)
- the CLI grew to 290 commands, adding test-data masking and conversation-test support

---

## Publishing it for everyone

Yes — as a **static site on GitHub Pages**. Not a "GitHub App": that's an installable
integration/bot, a different thing entirely. The explorer is plain HTML/CSS/JS with **no
runtime dependencies** — no CDN, no external fonts, no network calls — so it hosts anywhere
that serves files.

Two clearances that actually gate this, both checked:

| Gate | Status |
| --- | --- |
| **Licence** | Upstream is **UPL-1.0**, which explicitly permits copying, deriving from and distributing the software *and data*, provided the copyright notice travels along. `NOTICE.md`, `LICENSE-UPL-oracle.txt` and the attribution in the app footer satisfy that. |
| **Secrets** | The payload is scanned for password/token/key/private-key/email shapes before release — clean. The build reads only the exported upstream tree, never `env.properties`. |
| **Size** | `data.js` is 4.1 MB raw, **0.4 MB gzipped** (Pages gzips automatically). Pages caps are 100 MB/file and 1 GB/site. |

### Option A — Actions build, self-updating (recommended)

`.github/workflows/publish.yml` clones `oracle/fusion-ai-studio` itself, rebuilds the graph
and metrics, refuses to deploy if a secret-shaped string appears in the payload, and
publishes. It runs on push to `main`, weekly on Monday, or on demand — so the site tracks
upstream releases without anyone running the pipeline by hand. The derived graph is never
committed.

```bash
gh repo create fusion-agent-stack-explorer --public --source . --push
# then: Settings -> Pages -> Source = "GitHub Actions"
```

### Option B — commit the built site

Simplest, no CI. `./run.sh` writes `docs/`, which Pages can serve directly:

```bash
node tools/build-search-app.mjs --site      # writes docs/
git add docs && git commit -m "publish explorer" && git push
# then: Settings -> Pages -> Source = "Deploy from a branch", branch main, folder /docs
```

Your URL will be `https://<user>.github.io/<repo>/`. Both options give the same page.

### Option C — hand someone a file

`app/agent-stack-explorer.html` is the whole thing in one self-contained 4.3 MB file. Email
it, drop it in Slack, open it from a USB stick — it works offline with no server.

### What gets published, and what doesn't

Published: the explorer (`index.html`, `app.css`, `app.js`, `data.js`) plus the licence
notices. Not published: the Obsidian vault, `graphify-out/`, `.source/` and the venv — all
gitignored or excluded, all reproducible with `./run.sh --sync`.

The data is public Oracle sample content, so there is nothing confidential in it. Re-check
that claim yourself before pointing this at an internal corpus: the same pipeline over
private artifacts would publish private prompts and code.

## Setup

Recorded for reproducibility; already done here:

```bash
python3 -m venv .venv-graphify
.venv-graphify/bin/pip install graphifyy
```

Graphify is installed into a **local venv on purpose** — no global `pip install`, no
`graphify install`, no `graphify claude install`. That last one writes a graphify section into
your `CLAUDE.md` and registers a global `PreToolUse` hook; run it deliberately if you want the
`/graphify` slash command:

```bash
.venv-graphify/bin/graphify install --platform claude
```

Node 18+ is the only other requirement. The builders have no npm dependencies.

## Extending it

To add an artifact type or edge kind, work in `tools/extract-fusion-graph.mjs`:

1. Collect the files in the scan block near the top.
2. Add an entry to `ID`.
3. Emit with `addNode` / `addEdge`, and give the node type an entry in `FILE_TYPE` — that
   decides whether Graphify's dedup may label-merge it across files. Anything whose identity
   is its code belongs in the `code` bucket.
4. Add the type to `FOLDER` in the vault builder and `KEEP` in the app builder, plus a label
   in `REL_LABEL` / `REL_OUT` for any new relation.

The extractor is deliberately strict: unresolvable references become findings, and each run
prints counts by type, so a regression shows up as a number that moved.
