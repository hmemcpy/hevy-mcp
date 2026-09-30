import {
  AuthorizationError,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider"
import { secureEqual } from "./security"

const CSRF_COOKIE = "__Host-workout_oauth_csrf"

interface AuthorizationEnv {
  AUTOMATION_API_TOKEN: string
  OAUTH_PROVIDER: OAuthHelpers
}

export function makeAuthorizationHandler<Env extends AuthorizationEnv>(
  fallback: ExportedHandler<Env>,
): ExportedHandler<Env> {
  return {
    async fetch(request, env, ctx): Promise<Response> {
      const url = new URL(request.url)
      if (url.pathname !== "/authorize") {
        return fallback.fetch?.(request, env, ctx) ?? new Response("Not found", { status: 404 })
      }

      let oauthRequest: AuthRequest
      try {
        oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request)
      } catch (error) {
        return authorizationErrorResponse(error)
      }

      const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId)
      if (client === null) return html("Unknown OAuth client", 400)

      if (request.method === "GET") {
        const csrf = crypto.randomUUID()
        return html(authorizationPage(url, client.clientName ?? "ChatGPT", csrf), 200, {
          "set-cookie": `${CSRF_COOKIE}=${csrf}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`,
        })
      }

      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })

      const form = await request.formData()
      const csrf = form.get("csrf")
      const token = form.get("token")
      if (
        typeof csrf !== "string" ||
        typeof token !== "string" ||
        !(await secureEqual(csrf, readCookie(request, CSRF_COOKIE))) ||
        !(await secureEqual(token, env.AUTOMATION_API_TOKEN))
      ) {
        return html("Authorization failed. Close this page and try connecting again.", 401)
      }

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthRequest,
        userId: "owner",
        metadata: { clientName: client.clientName },
        scope: oauthRequest.scope,
        props: { userId: "owner" },
      })

      return new Response(null, {
        status: 302,
        headers: {
          location: redirectTo,
          "set-cookie": `${CSRF_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`,
        },
      })
    },
  }
}

function authorizationErrorResponse(error: unknown): Response {
  if (!(error instanceof AuthorizationError)) throw error
  if (error.redirectUri === undefined) return html(error.description, 400)
  const redirect = new URL(error.redirectUri)
  redirect.searchParams.set("error", error.code)
  redirect.searchParams.set("error_description", error.description)
  if (error.state !== undefined) redirect.searchParams.set("state", error.state)
  if (error.issuer !== undefined) redirect.searchParams.set("iss", error.issuer)
  return Response.redirect(redirect, 302)
}

function authorizationPage(url: URL, clientName: string, csrf: string): string {
  const action = escapeHtml(`${url.pathname}${url.search}`)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize workout access</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111827; }
    main { width: min(28rem, calc(100% - 2rem)); padding: 2rem; border-radius: 1rem; background: #1f2937; color: #f9fafb; box-shadow: 0 1rem 3rem #0008; }
    h1 { margin-top: 0; font-size: 1.5rem; }
    p { color: #d1d5db; line-height: 1.5; }
    label { display: block; margin: 1.5rem 0 .5rem; font-weight: 650; }
    input { box-sizing: border-box; width: 100%; padding: .8rem; border: 1px solid #6b7280; border-radius: .6rem; font: inherit; }
    button { width: 100%; margin-top: 1rem; padding: .85rem; border: 0; border-radius: .6rem; background: #22c55e; color: #052e16; font: inherit; font-weight: 750; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Authorize ${escapeHtml(clientName)}</h1>
    <p>This grants access to read workout data, manage one hosted active session, and create, edit, or delete completed workouts. Final save, routine changes, completed-workout corrections, and deletion use explicit previews.</p>
    <form method="post" action="${action}">
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      <label for="token">Automation access token</label>
      <input id="token" name="token" type="password" required autocomplete="current-password">
      <button type="submit">Authorize</button>
    </form>
  </main>
</body>
</html>`
}

function readCookie(request: Request, name: string): string {
  const cookie = request.headers.get("cookie") ?? ""
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=")
    if (key === name) return value.join("=")
  }
  return ""
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function html(body: string, status: number, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  })
}
