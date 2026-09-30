# Connect a client

Deploy your own Worker first. You need its HTTPS `/mcp` URL and the automation
token you chose during setup. A package alone cannot supply a Hevy session or
turn this into a shared hosted service.

## ChatGPT

Use the [custom MCP app setup](chatgpt.md). Add your Worker's `/mcp` URL, select
OAuth, and authorize on your own Worker hostname. ChatGPT plan and workspace
permissions determine which custom-app features are available.

There is no ChatGPT app-directory listing in this repository. The Codex package
below is a separate installation route, not a file to upload to ChatGPT's custom
MCP app form.

## Codex plugin

The generator builds a local marketplace containing a plugin configured for your
endpoint. It uses the supported `.codex-plugin/plugin.json` and `.mcp.json`
compatibility format. No environment-variable substitution is required.

From this repository, with Node.js 22 or newer:

```sh
node scripts/package-plugin.mjs \
  --url https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp \
  --output dist/my-hevy-plugin
```

Or use `bun run package:plugin` with the same arguments. The URL must be HTTPS,
end in `/mcp`, and contain no credentials, query string, or fragment. The output
folder must not already exist. To regenerate, choose a new folder.

The output contains:

```text
my-hevy-plugin/
  .agents/plugins/marketplace.json
  plugins/hevy-mcp/
    .codex-plugin/plugin.json
    .mcp.json
    LICENSE
    NOTICE
    SECURITY.md
  README.md
```

Keep that folder where the client can read it. Run the following commands on the
local computer where you use a compatible Codex desktop app or CLI, with the
folder's absolute path:

```sh
codex plugin marketplace add /absolute/path/to/dist/my-hevy-plugin
codex plugin add hevy-mcp@hevy-self-hosted
codex plugin list --json
```

The generator prints the commands with your actual output path. It does not run
them, edit your client settings, contact the endpoint, or start authorization.
If you've already registered `hevy-self-hosted`, update or remove that marketplace
through your client before adding another copy.

Complete OAuth when prompted. Check that the authorization page belongs to your
Worker, then enter the automation token there. Never put Hevy credentials or
bearer tokens in `.mcp.json`, the marketplace, or a conversation. The server
supports dynamic client registration, so the package does not embed a client
secret.

Start a new conversation after installation and try “List my routines without
changing anything.” Compare a result with Hevy before using write tools. Package
validation checks the files; it does not prove that a particular client version
can complete OAuth with your deployment.

The plugin grants access to the same single account as any other authorized
client. It has write tools and access to personal account/workout data. See
[security](../SECURITY.md) before connecting it.

The current formats and commands are documented in OpenAI's [plugin
guide](https://developers.openai.com/plugins/build/plugins), [MCP
configuration](https://learn.chatgpt.com/docs/extend/mcp), and [developer
commands](https://learn.chatgpt.com/docs/developer-commands).
