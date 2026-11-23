# Graphify

Sloop shares `graphify-out/graph.json` in Git so agents start from the same code map. The graph contains source names and relative paths; Graphify caches, reports, HTML, cost data, and machine-specific checkout markers stay local.

## Fresh clone setup

Install the Graphify CLI (`graphifyy` is the package name), then run a focused query from the repository root:

```powershell
graphify query "How does the dispatcher reach Worker and QA?"
```

Register the union merge driver for this clone. It merges two branches' graph nodes and edges and does not install Git hooks. Using the executable's absolute path also lets GUI Git clients invoke it when their `PATH` differs:

```powershell
$graphifyExecutable = (Get-Command graphify).Source
git config --local merge.graphify.name "graphify graph.json union merge"
git config --local merge.graphify.driver "`"$graphifyExecutable`" merge-driver %O %A %B"
```

Verify that Git has the local driver:

```powershell
git config --get merge.graphify.driver
```

Repeat this registration for each clone. Linked worktrees share the repository's `--local` config. To store it separately per worktree with `git config --worktree`, configure each worktree; this requires `extensions.worktreeConfig` to be enabled. `.gitattributes` is committed, so Git selects the driver whenever it is configured locally.

## Refreshing the graph

After relevant source changes or after pulling/switching to a branch whose graph may be stale, refresh it manually:

```powershell
graphify update .
graphify query "How does the dispatcher reach Worker and QA?"
```

Review and commit `graphify-out/graph.json` with the source changes. Generated files under `graphify-out/` are ignored and can be regenerated locally. No automatic commit or checkout hooks are required.
