import pkg from "../package.json"

// Single source of truth for the server identity. package.json is bundled by
// wrangler exactly like the generated exercise catalog, so the deployed
// Worker, /health, and MCP initialization all report the same version.

export const SERVER_NAME: string = pkg.name
export const SERVER_VERSION: string = pkg.version
