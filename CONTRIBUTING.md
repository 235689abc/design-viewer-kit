# Contributing

1. Keep the manifest schema generic and backwards-compatible where possible.
2. Keep the viewer read-only. Changes that write to a target project must be
   explicit, opt-in, and clearly separated from the default flow.
3. Do not add real project data, credentials, internal hostnames, or generated
   runtime snapshots to the repository. Extend `examples/minimal` instead.
4. Run the checks below before opening a pull request:

```bash
python3 tools/validate_manifest.py --spec docs/diagrams/flows.json
python3 tools/gen_diagrams.py --config design-viewer.config.json
npm run build
```

For larger changes, explain the manifest compatibility impact and update
`docs/USAGE.md` with a runnable example.

