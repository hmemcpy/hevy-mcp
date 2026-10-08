import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it } from "vitest"
import pkg from "../package.json"
import { createWorkoutMcpServer } from "../src/mcp"
import type { Env } from "../src/types"

// The 25 tools that shipped before 0.2.0. A regression here means an existing
// client workflow broke.
const PREEXISTING_TOOLS = [
  "get_recent_workouts",
  "get_workout",
  "get_workout_count",
  "search_exercises",
  "list_custom_exercises",
  "get_account",
  "get_body_measurements",
  "list_routine_folders",
  "list_routines",
  "get_routine",
  "get_exercise_history",
  "preview_routine_progression",
  "apply_routine_progression",
  "preview_completed_workout_edit",
  "apply_completed_workout_edit",
  "preview_completed_workout_exercise_insert",
  "apply_completed_workout_exercise_insert",
  "get_active_workout_session",
  "start_workout_session",
  "update_workout_session",
  "preview_finish_workout_session",
  "finish_workout_session",
  "discard_workout_session",
  "preview_completed_workout_delete",
  "delete_completed_workout",
]

function makeEnv(): Env {
  const namespace = {
    getByName: () => ({
      fetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        }),
    }),
  }
  return { SESSION_COORDINATOR: namespace } as unknown as Env
}

async function connect() {
  const server = createWorkoutMcpServer(makeEnv())
  const client = new Client({ name: "test-client", version: "0.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { server, client }
}

describe("MCP server surface", () => {
  it("advertises the package version during initialization", async () => {
    const { client } = await connect()
    const serverInfo = client.getServerVersion() as { name?: string; version?: string }
    expect(serverInfo.version).toBe(pkg.version)
    expect(serverInfo.name).toBe(pkg.name)
  })

  it("keeps every preexisting tool and adds the 0.2.0 tools", async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    const names = tools.map(tool => tool.name)
    for (const name of PREEXISTING_TOOLS) {
      expect(names, `missing preexisting tool ${name}`).toContain(name)
    }
    for (const name of [
      "get_server_info",
      "get_training_summary",
      "preview_body_measurement_save",
      "apply_body_measurement_save",
    ]) {
      expect(names, `missing new tool ${name}`).toContain(name)
    }
    expect(names).toHaveLength(29)
  })

  it("answers get_server_info without contacting the coordinator", async () => {
    const env = { SESSION_COORDINATOR: undefined } as unknown as Env
    const server = createWorkoutMcpServer(env)
    const client = new Client({ name: "test-client", version: "0.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const result = await client.callTool({ name: "get_server_info", arguments: {} })
    const payload = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "{}",
    ) as { name?: string; version?: string }
    expect(payload.name).toBe(pkg.name)
    expect(payload.version).toBe(pkg.version)
  })

  it("registers both prompts and renders them with string or omitted arguments", async () => {
    const { client } = await connect()
    const { prompts } = await client.listPrompts()
    expect(prompts.map(prompt => prompt.name).sort()).toEqual([
      "analyze_workout_progress",
      "start_workout_from_routine",
    ])

    const withWeeks = await client.getPrompt({
      name: "analyze_workout_progress",
      arguments: { weeks: "8" },
    })
    const weeksText = (withWeeks.messages[0]?.content as { text?: string }).text ?? ""
    expect(weeksText).toContain("last 8 weeks")

    const withoutArguments = await client.getPrompt({ name: "analyze_workout_progress" })
    const defaultText = (withoutArguments.messages[0]?.content as { text?: string }).text ?? ""
    expect(defaultText).toContain("last 4 weeks")

    const session = await client.getPrompt({
      name: "start_workout_from_routine",
      arguments: { routineId: "routine-7" },
    })
    const sessionText = (session.messages[0]?.content as { text?: string }).text ?? ""
    expect(sessionText).toContain("routine-7")
    expect(sessionText).toContain("preview_finish_workout_session")
    expect(sessionText).toContain("finish_workout_session")
  })
})
