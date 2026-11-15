import assert from "node:assert/strict";
import { afterAll, afterEach, beforeEach, test } from "vite-plus/test";
import * as v from "valibot";
import { signedInAs } from "../helpers/honoApp.ts";
import {
  cleanupIsolatedState,
  resetDatabase,
  setupIsolatedBackend,
} from "../helpers/backendTestHarness.ts";

const [state, { db }, plex, plexLogin, { userOps }, { default: authRoutes }] =
  await setupIsolatedBackend(
    "plex",
    () => import("../../backend/config/db-sqlite.ts"),
    () => import("../../backend/services/plex.ts"),
    () => import("../../backend/services/plexLogin.ts"),
    () => import("../../backend/db/helpers/index.ts"),
    () => import("../../backend/routes/auth.ts"),
  );

const originalFetch = globalThis.fetch;
const server = { url: "http://plex.test", token: "owner-token", sendPlaylists: true };
const plexTvIds: Record<string, number> = {
  "owner-token": 100,
  "friend-token": 7,
  "stranger-token": 9,
};
let loginToken: string | null = null;
let allowedResources: string[] = [];

function fakePlex() {
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const token = new Headers(init?.headers).get("x-plex-token") ?? "";
    if (url.href === "https://plex.tv/api/v2/user")
      return Response.json({ id: plexTvIds[token], username: token.replace("-token", "") });
    if (url.pathname === "/accounts")
      return Response.json({ MediaContainer: { Account: [{ id: 1 }, { id: 7 }] } });
    if (url.pathname === "/identity")
      return Response.json({ MediaContainer: { machineIdentifier: "my-server" } });
    if (url.pathname === "/api/v2/resources")
      return Response.json(
        allowedResources.map((id) => ({ clientIdentifier: id, provides: "server" })),
      );
    if (url.href === "https://plex.tv/api/v2/pins?strong=true")
      return Response.json({ id: 55, code: "abc" });
    if (url.href === "https://plex.tv/api/v2/pins/55?code=abc")
      return Response.json({ authToken: loginToken });
    return new Response(null, { status: 404 });
  };
}

beforeEach(() => {
  resetDatabase(db);
  loginToken = null;
  allowedResources = [];
  fakePlex();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(async () => {
  await cleanupIsolatedState(state);
});

test("a Plex sign-in maps the owner to account 1 and others to their plex.tv ID", async () => {
  assert.deepEqual(await plex.plexHistoryAccount(server, "owner-token"), {
    username: "owner",
    accountId: "1",
  });
  assert.deepEqual(await plex.plexHistoryAccount(server, "friend-token"), {
    username: "friend",
    accountId: "7",
  });
  await assert.rejects(
    plex.plexHistoryAccount(server, "stranger-token"),
    /stranger doesn't have access to this Plex server/,
  );
});

test("only the user who started a Plex sign-in can finish it", async () => {
  const { id } = await plex.startPlexSignIn(1);

  await assert.rejects(plex.finishPlexSignIn(2, id), /expired/);
  assert.equal(await plex.finishPlexSignIn(1, id), null);
});

test("connecting the server needs the owner's token", async () => {
  globalThis.fetch = async () => new Response(null, { status: 401 });

  await assert.rejects(
    plex.connectPlexServer("http://plex.test", "friend-token"),
    /Sign in with the Plex account that owns this server/,
  );
  assert.equal(plex.getPlexServer(), null);
});

test("Plex login checks current server access, binds the browser and never links by username", async () => {
  plex.savePlexServer(server);
  userOps.createUser("friend", "hash", "admin", null, true);
  loginToken = "friend-token";

  const first = await plexLogin.startPlexLogin(null);
  await assert.rejects(
    plexLogin.completePlexLogin(first.id, "aurral_plex_login=wrong", null, null, null),
    /expired/,
  );
  await assert.rejects(
    plexLogin.completePlexLogin(first.id, `aurral_plex_login=${first.secret}`, null, null, null),
    /doesn't have access/,
  );
  assert.equal(
    db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM sessions").get()?.count,
    0,
  );

  allowedResources = ["my-server"];
  const second = await plexLogin.startPlexLogin(null);
  const result = await plexLogin.completePlexLogin(
    second.id,
    `aurral_plex_login=${second.secret}`,
    null,
    null,
    null,
  );
  assert.ok(result.done && !result.linked);
  assert.equal(result.user.username, "friend-2");
  assert.equal(result.user.role, "user");
  assert.equal(userOps.getUserByUsername("friend")?.role, "admin");
  await assert.rejects(
    plexLogin.completePlexLogin(second.id, `aurral_plex_login=${second.secret}`, null, null, null),
    /expired/,
  );

  userOps.updateUser(result.user.id, { status: "suspended" });
  const third = await plexLogin.startPlexLogin(null);
  await assert.rejects(
    plexLogin.completePlexLogin(third.id, `aurral_plex_login=${third.secret}`, null, null, null),
    /suspended or disabled/,
  );
});

test("Plex can be explicitly linked to an existing account", async () => {
  plex.savePlexServer(server);
  const admin = userOps.createUser("admin", "hash", "admin", null, true);
  assert.ok(admin);
  loginToken = "owner-token";
  allowedResources = ["my-server"];
  const start = await plexLogin.startPlexLogin(admin.id);
  const result = await plexLogin.completePlexLogin(
    start.id,
    `aurral_plex_login=${start.secret}`,
    admin.id,
    null,
    null,
  );
  assert.deepEqual(result, { done: true, linked: true });
  const login = await plexLogin.startPlexLogin(null);
  const signedIn = await plexLogin.completePlexLogin(
    login.id,
    `aurral_plex_login=${login.secret}`,
    null,
    null,
    null,
  );
  assert.ok(signedIn.done && !signedIn.linked);
  assert.equal(signedIn.user.id, admin.id);
});

test("Plex login routes require the original browser cookie and issue a session", async () => {
  plex.savePlexServer(server);
  loginToken = "friend-token";
  allowedResources = ["my-server"];
  const app = signedInAs(undefined).route("/", authRoutes);
  const start = await app.request("/auth/plex/start", { method: "POST" });
  assert.equal(start.status, 200);
  const cookie = start.headers.get("set-cookie");
  assert.ok(cookie);
  assert.ok(cookie.includes("HttpOnly"));
  const startBody: unknown = await start.json();
  const { id } = v.parse(v.object({ id: v.string() }), startBody);
  const finish = (headers: Record<string, string>) =>
    app.request("/auth/plex/finish", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ id }),
    });
  assert.equal((await finish({})).status, 400);
  const response = await finish({ cookie });
  assert.equal(response.status, 200);
  const responseBody: unknown = await response.json();
  assert.ok(v.parse(v.object({ token: v.string() }), responseBody).token);
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/);
  assert.equal((await app.request("/auth/plex/link/start", { method: "POST" })).status, 401);
});
