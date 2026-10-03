import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repository = fileURLToPath(new URL("../", import.meta.url))

export function validateEndpoint(value) {
  if (
    typeof value !== "string" ||
    /\s/.test(value) ||
    Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    throw new Error("Endpoint must not contain whitespace or control characters")
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error("Supply the HTTPS /mcp URL of your own deployed Worker")
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/mcp" ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".") ||
    url.hostname.endsWith(".local") ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.startsWith("[") ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname)
  ) {
    throw new Error(
      "Use an HTTPS hostname ending in /mcp, with no credentials, query string, or fragment",
    )
  }
  return url.href
}

export async function packagePlugin({ url, output }) {
  const endpoint = validateEndpoint(url)
  if (Array.from(output).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    throw new Error("Output path must not contain control characters")
  const target = resolve(output)
  await mkdir(dirname(target), { recursive: true })
  // Never merge into an existing folder, follow a preexisting output symlink,
  // or overwrite an installed package. Regenerate into a new directory.
  await mkdir(target)
  const plugin = join(target, "plugins", "hevy-mcp")
  await mkdir(join(plugin, ".codex-plugin"), { recursive: true })
  await mkdir(join(target, ".agents", "plugins"), { recursive: true })
  const read = relative => readFile(join(repository, relative), "utf8")
  await writeFile(
    join(plugin, ".codex-plugin", "plugin.json"),
    await read("packaging/codex/plugin.json"),
    { flag: "wx" },
  )
  await writeFile(
    join(target, ".agents", "plugins", "marketplace.json"),
    await read("packaging/codex/marketplace.json"),
    { flag: "wx" },
  )
  await writeFile(
    join(plugin, ".mcp.json"),
    `${JSON.stringify({ mcpServers: { hevy: { type: "http", url: endpoint } } }, null, 2)}\n`,
    { flag: "wx" },
  )
  for (const name of ["LICENSE", "NOTICE", "SECURITY.md"]) {
    const contents = (await read(name)).replaceAll(
      "(docs/deployment.md)",
      "(https://github.com/hmemcpy/hevy-mcp/blob/main/docs/deployment.md)",
    )
    await writeFile(join(plugin, name), contents, { flag: "wx" })
  }
  await writeFile(
    join(target, "README.md"),
    `# Hevy self-hosted plugin\n\nEndpoint: ${endpoint}\n\nThis folder is a local Codex marketplace. Keep the folder available after adding\nit. From a client with plugin support:\n\n1. Run codex plugin marketplace add with this folder's absolute path.\n2. Run codex plugin add hevy-mcp@hevy-self-hosted.\n3. Complete OAuth on your own Worker's hostname. Enter the automation token\n   there, never in chat or in a package file.\n4. Start a new conversation and ask to list routines without changing them.\n\nThe package contains no credentials and does not deploy a server. It grants no\nread-only isolation: authorized clients can read personal workout/account data\nand use write tools. Review previews before applying writes.\n\nIf you already added a marketplace named hevy-self-hosted, use your client's\nmarketplace controls to remove or update that registration before adding a new\ncopy. This generator never changes your client configuration.\n\nFor ChatGPT, use the custom MCP app/OAuth setup instead of importing this folder:\nhttps://github.com/hmemcpy/hevy-mcp/blob/main/docs/chatgpt.md\n`,
    { flag: "wx" },
  )
  return { target, plugin, endpoint }
}

function argumentsFor(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === "--help" || flag === "-h") return null
    if (
      !["--url", "--output"].includes(flag) ||
      !argv[index + 1] ||
      argv[index + 1].startsWith("--")
    ) {
      throw new Error(
        "Usage: node scripts/package-plugin.mjs --url https://YOUR-WORKER/mcp --output dist/my-hevy-plugin",
      )
    }
    if (options[flag] !== undefined) throw new Error("Specify each option once")
    options[flag] = argv[++index]
  }
  if (!options["--url"]) throw new Error("--url is required; there is no shared public endpoint")
  return {
    url: options["--url"],
    output: options["--output"] ?? join(repository, "dist", "hevy-plugin"),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = argumentsFor(process.argv.slice(2))
    if (!options) {
      console.log(
        "Usage: bun run package:plugin --url https://YOUR-WORKER/mcp [--output dist/my-hevy-plugin]",
      )
    } else {
      const result = await packagePlugin(options)
      console.log(`Created plugin marketplace: ${result.target}`)
      console.log("To install in a client with plugin support, run:")
      console.log(`  codex plugin marketplace add '${result.target.replaceAll("'", "'\\''")}'`)
      console.log("  codex plugin add hevy-mcp@hevy-self-hosted")
      console.log(
        "Then authorize on your Worker and test a read-only request. No client settings or credentials were changed.",
      )
    }
  } catch (error) {
    console.error(
      error.code === "EEXIST"
        ? "Output already exists. Choose a new directory; nothing was overwritten."
        : error.message,
    )
    process.exitCode = 1
  }
}
