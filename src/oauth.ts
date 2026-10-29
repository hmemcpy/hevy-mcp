import {
  AuthorizationError,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider"
import {
  issueTransaction,
  listPasskeys,
  readTransaction,
  savePasskey,
  updateSignCount,
} from "./passkeys"
import { secureEqual } from "./security"
import {
  base64UrlDecode,
  base64UrlEncode,
  coseKeyToJwk,
  parseAttestationObject,
  verifyAssertion,
  WebAuthnError,
} from "./webauthn"

const CSRF_COOKIE = "__Host-workout_oauth_csrf"
const JSON_BODY_LIMIT = 64 * 1024

interface AuthorizationEnv {
  AUTOMATION_API_TOKEN: string
  OAUTH_KV: KVNamespace
  OAUTH_PROVIDER: OAuthHelpers
}

interface ClientCredential {
  rawId?: unknown
  response?: {
    clientDataJSON?: unknown
    attestationObject?: unknown
    authenticatorData?: unknown
    signature?: unknown
  }
}

interface PasskeyRequestBody {
  csrf?: unknown
  token?: unknown
  query?: unknown
  transactionId?: unknown
  credential?: ClientCredential
}

export function makeAuthorizationHandler<Env extends AuthorizationEnv>(
  fallback: ExportedHandler<Env>,
): ExportedHandler<Env> {
  return {
    async fetch(request, env, ctx): Promise<Response> {
      const url = new URL(request.url)
      if (request.method === "POST" && url.pathname.startsWith("/authorize/passkey/")) {
        return passkeyEndpoint(request, env, url)
      }
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
        const passkeys = (await listPasskeys(env.OAUTH_KV)).filter(
          item => item.rpId === url.hostname,
        )
        return html(
          authorizationPage(url, client.clientName ?? "ChatGPT", csrf, passkeys.length > 0),
          200,
          {
            "set-cookie": `${CSRF_COOKIE}=${csrf}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`,
          },
        )
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

async function passkeyEndpoint(
  request: Request,
  env: AuthorizationEnv,
  url: URL,
): Promise<Response> {
  const body = await readJsonBody(request)
  if (body === null) return jsonError("Invalid request body", 400)
  if (
    typeof body.csrf !== "string" ||
    !(await secureEqual(body.csrf, readCookie(request, CSRF_COOKIE)))
  ) {
    return jsonError("Session expired. Reload this page and try again.", 401)
  }
  try {
    if (url.pathname === "/authorize/passkey/enroll") return await enrollStart(env, url, body)
    if (url.pathname === "/authorize/passkey/enroll/finish")
      return await enrollFinish(env, url, body)
    if (url.pathname === "/authorize/passkey/options") return await assertStart(env, url, body)
    if (url.pathname === "/authorize/passkey/verify") return await assertVerify(env, url, body)
  } catch (error) {
    if (error instanceof AuthorizationError) return jsonError(error.description, 400)
    if (error instanceof WebAuthnError) return jsonError(error.message, 401)
    throw error
  }
  return jsonError("Not found", 404)
}

async function readJsonBody(request: Request): Promise<PasskeyRequestBody | null> {
  if (Number(request.headers.get("content-length") ?? 0) > JSON_BODY_LIMIT) return null
  try {
    const parsed = JSON.parse(await request.text()) as PasskeyRequestBody
    return typeof parsed === "object" && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

async function parseStoredAuthRequest(
  env: AuthorizationEnv,
  url: URL,
  query: unknown,
): Promise<AuthRequest> {
  if (typeof query !== "string" || query.length > 4096)
    throw new AuthorizationError("invalid_request", {
      description: "The authorization request is missing",
    })
  const rebuilt = new Request(`${url.origin}/authorize?${query}`)
  return env.OAUTH_PROVIDER.parseAuthRequest(rebuilt)
}

async function completeAuthorization(
  env: AuthorizationEnv,
  oauthRequest: AuthRequest,
): Promise<Response> {
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId)
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthRequest,
    userId: "owner",
    metadata: { clientName: client?.clientName },
    scope: oauthRequest.scope,
    props: { userId: "owner" },
  })
  return jsonResponse({ redirectTo })
}

async function enrollStart(
  env: AuthorizationEnv,
  url: URL,
  body: PasskeyRequestBody,
): Promise<Response> {
  if (
    typeof body.token !== "string" ||
    !(await secureEqual(body.token, env.AUTOMATION_API_TOKEN))
  ) {
    return jsonError("Incorrect automation token.", 401)
  }
  await parseStoredAuthRequest(env, url, body.query)
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const transactionId = await issueTransaction(
    env.AUTOMATION_API_TOKEN,
    "enroll",
    challenge,
    url.hostname,
  )
  return jsonResponse({
    transactionId,
    options: {
      challenge: base64UrlEncode(challenge),
      rp: { id: url.hostname, name: "Hevy MCP" },
      user: {
        id: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
        name: "owner",
        displayName: "Owner",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      timeout: 120_000,
      attestation: "none",
    },
  })
}

async function enrollFinish(
  env: AuthorizationEnv,
  url: URL,
  body: PasskeyRequestBody,
): Promise<Response> {
  if (typeof body.transactionId !== "string") return jsonError("Missing transaction", 400)
  const credential = body.credential ?? {}
  const clientDataJSON = expectString(credential.response?.clientDataJSON, "client data")
  const attestationObject = expectString(credential.response?.attestationObject, "attestation")
  const rawId = expectString(credential.rawId, "credential id")
  const oauthRequest = await parseStoredAuthRequest(env, url, body.query)
  const { challenge, rpId } = await readTransaction(
    env.AUTOMATION_API_TOKEN,
    body.transactionId,
    "enroll",
  )

  const clientDataBytes = base64UrlDecode(clientDataJSON)
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as Record<
    string,
    unknown
  >
  if (clientData.type !== "webauthn.create") throw new WebAuthnError("Unexpected client data type")
  if (clientData.challenge !== base64UrlEncode(challenge))
    throw new WebAuthnError("Challenge does not match")
  if (clientData.origin !== url.origin) throw new WebAuthnError("Origin does not match")

  const attestation = parseAttestationObject(base64UrlDecode(attestationObject))
  const authenticatorData = attestation.authenticatorData
  if (!authenticatorData.userPresent || !authenticatorData.userVerified) {
    throw new WebAuthnError("User verification (fingerprint) was not performed")
  }
  if (attestation.authenticatorData.attestedCredential === undefined) {
    throw new WebAuthnError("Attestation does not contain a credential")
  }
  const credentialId = base64UrlEncode(
    attestation.authenticatorData.attestedCredential.credentialId,
  )
  if (credentialId !== rawId) throw new WebAuthnError("Credential id does not match")
  if (!(await rpIdMatches(authenticatorData.rpIdHash, rpId)))
    throw new WebAuthnError("RP ID does not match")
  const key = coseKeyToJwk(attestation.coseKey)

  await savePasskey(env.OAUTH_KV, {
    id: credentialId,
    alg: key.alg,
    jwk: key.jwk,
    rpId,
    origin: url.origin,
    createdAt: new Date().toISOString(),
    signCount: authenticatorData.signCount,
  })
  return completeAuthorization(env, oauthRequest)
}

async function assertStart(
  env: AuthorizationEnv,
  url: URL,
  body: PasskeyRequestBody,
): Promise<Response> {
  await parseStoredAuthRequest(env, url, body.query)
  const stored = (await listPasskeys(env.OAUTH_KV)).filter(item => item.rpId === url.hostname)
  if (stored.length === 0) return jsonError("No passkey is enrolled for this site yet.", 404)
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const transactionId = await issueTransaction(
    env.AUTOMATION_API_TOKEN,
    "assert",
    challenge,
    url.hostname,
  )
  return jsonResponse({
    transactionId,
    options: {
      challenge: base64UrlEncode(challenge),
      rpId: url.hostname,
      allowCredentials: stored.map(item => ({ type: "public-key", id: item.id })),
      userVerification: "required",
      timeout: 120_000,
    },
  })
}

async function assertVerify(
  env: AuthorizationEnv,
  url: URL,
  body: PasskeyRequestBody,
): Promise<Response> {
  if (typeof body.transactionId !== "string") return jsonError("Missing transaction", 400)
  const credential = body.credential ?? {}
  const clientDataJSON = expectString(credential.response?.clientDataJSON, "client data")
  const authenticatorData = expectString(
    credential.response?.authenticatorData,
    "authenticator data",
  )
  const signature = expectString(credential.response?.signature, "signature")
  const rawId = expectString(credential.rawId, "credential id")
  const oauthRequest = await parseStoredAuthRequest(env, url, body.query)
  const { challenge, rpId } = await readTransaction(
    env.AUTOMATION_API_TOKEN,
    body.transactionId,
    "assert",
  )
  const stored = (await listPasskeys(env.OAUTH_KV)).find(
    item => item.id === rawId && item.rpId === rpId,
  )
  if (stored === undefined) return jsonError("Unknown passkey for this site.", 401)

  const signCount = await verifyAssertion({
    jwk: stored.jwk,
    alg: stored.alg,
    clientDataJSON: base64UrlDecode(clientDataJSON),
    authenticatorData: base64UrlDecode(authenticatorData),
    signature: base64UrlDecode(signature),
    expectedChallenge: challenge,
    expectedOrigin: url.origin,
    expectedRpId: rpId,
    storedSignCount: stored.signCount,
  })
  await updateSignCount(env.OAUTH_KV, stored.id, signCount)
  return completeAuthorization(env, oauthRequest)
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw new WebAuthnError(`Missing ${label}`)
  return value
}

async function rpIdMatches(rpIdHash: Uint8Array, rpId: string): Promise<boolean> {
  const expected = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId) as BufferSource),
  )
  if (rpIdHash.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= (rpIdHash[index] ?? 0) ^ (expected[index] ?? 0)
  }
  return difference === 0
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

function authorizationPage(
  url: URL,
  clientName: string,
  csrf: string,
  hasPasskey: boolean,
): string {
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
    input[type="checkbox"] { width: auto; }
    .check { display: flex; gap: .6rem; align-items: flex-start; margin-top: 1rem; color: #d1d5db; font-size: .9rem; line-height: 1.4; }
    button { width: 100%; margin-top: 1rem; padding: .85rem; border: 0; border-radius: .6rem; background: #22c55e; color: #052e16; font: inherit; font-weight: 750; cursor: pointer; }
    button.secondary { background: #374151; color: #f9fafb; }
    button:disabled { opacity: .6; cursor: wait; }
    details { margin-top: 1.5rem; }
    summary { color: #9ca3af; cursor: pointer; }
    #status { margin-top: 1rem; color: #fca5a5; min-height: 1.4em; }
  </style>
</head>
<body>
  <main>
    <h1>Authorize ${escapeHtml(clientName)}</h1>
    <p>This grants access to read workout data, manage one hosted active session, and create, edit, or delete completed workouts. Final save, routine changes, completed-workout corrections, and deletion use explicit previews.</p>
    <button id="passkey" type="button" hidden>Approve with this device</button>
    <form id="token-form" method="post" action="${action}">
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      <label for="token">Automation access token</label>
      <input id="token" name="token" type="password" required autocomplete="current-password">
      <div class="check">
        <input id="enroll" name="enroll" type="checkbox" checked>
        <label for="enroll" style="margin:0;font-weight:400">Remember this device — approve future sign-ins with its fingerprint or screen lock</label>
      </div>
      <button id="submit" type="submit">Authorize</button>
    </form>
    <details ${hasPasskey ? "" : "hidden"}>
      <summary>Use the access token instead</summary>
    </details>
    <p id="status" role="status"></p>
  </main>
  <script>
  (function () {
    var hasPasskey = ${hasPasskey ? "true" : "false"};
    var csrf = ${JSON.stringify(csrf)};
    var query = location.search.slice(1);
    var status = document.getElementById("status");
    var passkeyButton = document.getElementById("passkey");
    var tokenForm = document.getElementById("token-form");
    var enrollCheckbox = document.getElementById("enroll");
    var details = document.querySelector("details");
    if (hasPasskey) {
      passkeyButton.hidden = false;
      details.hidden = false;
      tokenForm.hidden = true;
      details.addEventListener("toggle", function () { tokenForm.hidden = !details.open; });
    }
    function setStatus(message) { status.textContent = message || ""; }
    function b64uToBuffer(value) {
      var normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      while (normalized.length % 4) normalized += "=";
      var binary = atob(normalized);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }
    function bufferToB64u(buffer) {
      var bytes = new Uint8Array(buffer);
      var binary = "";
      for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    }
    function post(path, payload) {
      return fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ csrf: csrf, query: query }, payload)),
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok) throw new Error(body.error || "Request failed");
          return body;
        });
      });
    }
    function busy(button, busy_) {
      button.disabled = busy_;
      button.textContent = busy_ ? "Waiting…" : button.id === "passkey" ? "Approve with this device" : "Authorize";
    }
    passkeyButton.addEventListener("click", function () {
      busy(passkeyButton, true);
      setStatus("");
      post("/authorize/passkey/options", {}).then(function (start) {
        var options = start.options;
        var publicKey = {
          challenge: b64uToBuffer(options.challenge),
          rpId: options.rpId,
          allowCredentials: options.allowCredentials.map(function (item) {
            return { type: item.type, id: b64uToBuffer(item.id) };
          }),
          userVerification: options.userVerification,
          timeout: options.timeout,
        };
        return navigator.credentials.get({ publicKey: publicKey }).then(function (assertion) {
          return post("/authorize/passkey/verify", {
            transactionId: start.transactionId,
            credential: {
              rawId: bufferToB64u(assertion.rawId),
              response: {
                clientDataJSON: bufferToB64u(assertion.response.clientDataJSON),
                authenticatorData: bufferToB64u(assertion.response.authenticatorData),
                signature: bufferToB64u(assertion.response.signature),
              },
            },
          });
        });
      }).then(function (result) { location.href = result.redirectTo; })
        .catch(function (error) { busy(passkeyButton, false); setStatus(error.message); });
    });
    tokenForm.addEventListener("submit", function (event) {
      if (!enrollCheckbox.checked || !window.PublicKeyCredential) return;
      event.preventDefault();
      var token = document.getElementById("token").value;
      var submit = document.getElementById("submit");
      busy(submit, true);
      setStatus("");
      post("/authorize/passkey/enroll", { token: token }).then(function (start) {
        var options = start.options;
        var publicKey = {
          challenge: b64uToBuffer(options.challenge),
          rp: options.rp,
          user: { id: b64uToBuffer(options.user.id), name: options.user.name, displayName: options.user.displayName },
          pubKeyCredParams: options.pubKeyCredParams,
          authenticatorSelection: options.authenticatorSelection,
          timeout: options.timeout,
          attestation: options.attestation,
        };
        return navigator.credentials.create({ publicKey: publicKey }).then(function (credential) {
          return post("/authorize/passkey/enroll/finish", {
            transactionId: start.transactionId,
            credential: {
              rawId: bufferToB64u(credential.rawId),
              response: {
                clientDataJSON: bufferToB64u(credential.response.clientDataJSON),
                attestationObject: bufferToB64u(credential.response.attestationObject),
              },
            },
          });
        });
      }).then(function (result) { location.href = result.redirectTo; })
        .catch(function (error) { busy(submit, false); setStatus(error.message); });
    });
  })();
  </script>
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

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  })
}

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  })
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
