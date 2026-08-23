# Drop your own exports here

Anything you export from a live Fusion AI Agent Studio environment goes in this
folder, then `./run.sh` folds it into the graph alongside Oracle's samples.

Both export shapes are handled:

| From the console | You get | Notes |
| --- | --- | --- |
| **Applications** → download | `MY_APP.json` | one file; its `specification` is a JSON *string*, which the ingester parses |
| **Workflows** → download | `my_workflow.zip` | a `src/` tree: workflows, agents, businessObjects, tools |

Files are classified by their contents, not their extension, so the names Fusion
gives them are fine as-is. Ingested artifacts are tagged `origin: local` and
show a **your environment** badge in the explorer.

This folder is gitignored apart from this note — your artifacts are not
committed or published.
