# Design Viewer Kit

Design Viewer Kit turns a small, reviewable flow manifest into a navigable
design inventory: service and table ownership, CRUD edges, Mermaid diagrams,
flow detail pages, governance checks, and optional GET-only runtime evidence.
It is designed to be copied into an existing project or used as a standalone
viewer for architecture reviews.

The default mode is static and read-only. The kit does not scan a production
database, call a write API, run migrations, or restart a service.

## Quick start

Requirements: Node.js 18+, npm, and Python 3.10+.

```bash
git clone https://github.com/235689abc/design-viewer-kit.git
cd design-viewer-kit
npm install
python3 tools/validate_manifest.py --spec docs/diagrams/flows.json
npm run generate
npm run build
npm run dev
```

Open the local Vite URL shown in the terminal. The repository includes a
small generic order example, so the viewer is useful immediately after the
first build.

## Use it for another project

1. Copy `design-viewer.config.example.json` to a config file in the target
   project.
2. Create `docs/diagrams/flows.json` using the manifest shape described in
   [`docs/USAGE.md`](docs/USAGE.md). Keep names and source references
   project-specific, but do not include secrets.
3. Generate the static artifacts:

   ```bash
   python3 /path/to/design-viewer-kit/tools/validate_manifest.py \
     --spec docs/diagrams/flows.json
   python3 /path/to/design-viewer-kit/tools/gen_diagrams.py \
     --config design-viewer.config.json
   ```

4. Serve `apps/web` with Vite, or host the generated
   `apps/web/public/data/index.json` beside the viewer. A different manifest
   URL can be supplied with `VITE_DV_DATA_URL` or the `?data=` query parameter.

The generator preserves unknown fields on services, tables, and flows. This
lets a project add evidence links, endpoint metadata, state-machine notes, or
other review fields without losing them during regeneration.

## Scaffold a new flow safely

The scaffolder creates review documents, a patch proposal, and an output-only
backend skeleton. It is dry-run by default:

```bash
python3 tools/scaffold_flow.py \
  --root . \
  --flow-id FLOW-EXAMPLE-001 \
  --name-en "Create order" \
  --name-zh "创建订单" \
  --owner-service orders-api \
  --reads public.customers \
  --writes public.orders:C \
  --events-appended OrderCreated \
  --dry-run
```

Review the printed paths and generated artifacts, then apply the manifest
patch explicitly with `tools/apply_flows_patch.py --apply`. The generated
backend file is a review artifact, not a production handler.

## Optional runtime evidence

The viewer can display recent flow metrics and event/outbox health when a
project exposes read-only JSON endpoints. Configure paths in the manifest's
`meta.policy.runtime_paths` or with `VITE_DV_RUNTIME_*` environment variables.
The adapter only performs GET requests and treats unavailable runtime data as
unknown; static design data remains usable.

## What this kit covers

- service, system, and table ownership
- flow reads/writes and CRUD matrix
- L0 system map, flow sequence, and table impact diagrams
- design-time governance checks (ownership, idempotency, event/outbox trail)
- optional runtime health evidence
- deterministic Python generation and manifest validation

## Current boundary

This standalone package is the flow/table viewer MVP. It is not yet a full
repository-wide endpoint, page, worker, RBAC, environment-flag, or source
evidence scanner. Those inventory dimensions are intentionally left as a
backwards-compatible manifest extension rather than inferred from a generic
project. See the roadmap in [`docs/USAGE.md`](docs/USAGE.md).

## Privacy and publishing

Generated indexes can disclose internal topology. Before pushing a target
project's data to a public repository, remove credentials, private hostnames,
customer identifiers, source filesystem paths, and sensitive table/route
names. The example data in this repository is synthetic and contains no
project-specific inventory.

## License

MIT; see [`LICENSE`](LICENSE).
