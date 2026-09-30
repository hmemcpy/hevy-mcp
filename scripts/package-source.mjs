import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))

export async function writeArchive(directory, name, bytes) {
  assert.equal(basename(name), name, "Archive name must be a filename")
  await mkdir(directory, { recursive: true })
  const directoryInfo = await lstat(directory)
  assert.ok(
    directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(),
    "Archive directory must not be a symlink",
  )
  const path = join(directory, name)
  for (const candidate of [path, `${path}.sha256`]) {
    try {
      await lstat(candidate)
      throw new Error("Archive output already exists; refusing to overwrite it")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
  const digest = createHash("sha256").update(bytes).digest("hex")
  await writeFile(path, bytes, { flag: "wx" })
  await writeFile(`${path}.sha256`, `${digest}  ${name}\n`, { flag: "wx" })
  return path
}

export async function packageSource() {
  execFileSync(process.execPath, [join(root, "scripts/check-package.mjs")], { stdio: "inherit" })
  // Archive the exact committed tree, never the working directory or ignored files.
  execFileSync("git", ["diff", "--quiet", "HEAD", "--"], { cwd: root })
  for (const required of [
    "CONTRIBUTING.md",
    "docs/clients.md",
    "packaging/codex/plugin.json",
    "packaging/codex/marketplace.json",
    "scripts/package-plugin.mjs",
    "scripts/check-package.mjs",
    "scripts/package-source.mjs",
  ]) {
    execFileSync("git", ["cat-file", "-e", `HEAD:${required}`], { cwd: root })
  }
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  const name = `hevy-mcp-${version}-${sha.slice(0, 12)}.zip`
  const bytes = execFileSync("git", ["archive", "--format=zip", "--prefix=hevy-mcp/", "HEAD"], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  })
  const path = await writeArchive(join(root, "dist"), name, bytes)
  console.log(`Created ${path} from commit ${sha}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  packageSource().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
