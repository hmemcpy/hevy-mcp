# Contributing

Use Bun 1.3.14 and Node.js 22 or newer. Start with:

```sh
bun install --frozen-lockfile
bun run check
```

The checks cover synthetic-data tests, catalog/package preparation, TypeScript,
Biome, and a Wrangler dry run. They do not contact Hevy or deploy a Worker. A
local `bun run dev` with real credentials can make real API requests.

Keep credentials, `.dev.vars`, private catalogs, and generated packages out of
commits. Don't paste a live account or workout response into a test fixture or an
issue. Use small synthetic examples that reproduce the behavior.

This server targets one account per deployment. Changes to OAuth storage,
preview validation, or workout serialization need focused tests. Preserve the
Durable Object class and storage keys unless the change includes a reviewed
migration plan.

## Client packaging

`packaging/codex/` contains metadata, not an installed plugin. Generate a package
with your own `/mcp` URL using [the client guide](docs/clients.md). The generator
must never install it automatically or include authentication material.

Update the package, MCP server, and plugin versions together. Run `bun run
check:package` after metadata changes. URL validation and no-overwrite behavior
have regression tests in `test/plugin-package.node.mjs`.

## Source archives

From a clean Git checkout:

```sh
bun run package:source
```

This archives the exact committed tree into `dist/`, with a SHA-256 checksum.
Ignored credentials, local catalogs, and generated packages are not included.
The archive contains the plugin generator, not a plugin pointing at somebody
else's server. Uncommitted tracked changes or existing output files make this command fail.

CI uploads the source archive after checks pass. These are build artifacts, not
published releases. Creating a tag or release and deploying a Worker are separate
maintainer actions; pushing a branch does neither.
