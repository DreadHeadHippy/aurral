import crypto from "node:crypto";
import { db } from "../config/db-sqlite.ts";
import { createSession } from "../config/session-helpers.ts";
import { userIdentityOps, userOps } from "../db/helpers/index.ts";
import { pruneExpired, reconcileLocalNetworkBypassSetting, toResolvedUser } from "./auth.ts";
import { hashPassword } from "./passwordHash.ts";
import { websocketService } from "./websocketService.ts";
import { finishPlexSignIn, getPlexServer, plexLoginAccount, startPlexSignIn } from "./plex.ts";

const COOKIE = "aurral_plex_login";
const TTL = 10 * 60 * 1000;
const PROVIDER = "plex-login";
const KEY = "https://plex.tv";
const pending = new Map<
  string,
  { id: string; userId: number | null; expiresAt: number; inFlight: boolean }
>();

export function plexLoginEnabled() {
  return Boolean(getPlexServer());
}

export function plexLoginCookie(secret: string, secure: boolean, maxAge = TTL / 1000) {
  return `${COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function cookieValue(header: string | undefined) {
  return (
    (header || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) || ""
  );
}

export async function startPlexLogin(userId: number | null) {
  if (!plexLoginEnabled()) throw new Error("An admin must connect the Plex server first");
  pruneExpired(pending);
  const secret = crypto.randomBytes(32).toString("hex");
  const result = await startPlexSignIn(secret);
  pending.set(secret, { id: result.id, userId, expiresAt: Date.now() + TTL, inFlight: false });
  return { ...result, secret };
}

export async function completePlexLogin(
  id: string,
  cookie: string | undefined,
  userId: number | null,
  ip: string | null,
  userAgent: string | null,
) {
  pruneExpired(pending);
  const secret = cookieValue(cookie);
  const transaction = pending.get(secret);
  if (!transaction || transaction.id !== id || transaction.userId !== userId)
    throw new Error("The Plex sign-in expired. Try again.");
  if (transaction.inFlight) throw new Error("Plex sign-in is already being checked");
  transaction.inFlight = true;
  let token: string | null;
  try {
    token = await finishPlexSignIn(secret, id);
  } finally {
    transaction.inFlight = false;
  }
  if (!token) return { done: false as const };
  pending.delete(secret);
  const server = getPlexServer();
  if (!server) throw new Error("The Plex server is no longer connected");
  const identity = await plexLoginAccount(server, token);
  const linked = userIdentityOps.findByProvider(PROVIDER, KEY, identity.id);
  if (userId) {
    const user = userOps.getUserById(userId);
    if (!user || user.status !== "active") throw new Error("This account cannot sign in");
    if (linked && linked.userId !== userId)
      throw new Error("This Plex account is linked to another user");
    if (!linked)
      userIdentityOps.link(userId, {
        providerType: PROVIDER,
        providerKey: KEY,
        subject: identity.id,
        displayName: identity.username,
      });
    return { done: true as const, linked: true as const };
  }
  const user = db.transaction(() => {
    if (linked) return userOps.getUserById(linked.userId);
    const base = identity.username.trim().toLowerCase();
    if (!base) throw new Error("Plex did not provide a username");
    let username = base;
    for (let suffix = 2; userOps.getUserByUsername(username); suffix += 1) {
      if (suffix > 1000) throw new Error("Could not create a unique username");
      username = `${base}-${suffix}`;
    }
    const created = userOps.createUser(
      username,
      hashPassword(crypto.randomBytes(32).toString("hex")),
      "user",
      null,
      false,
    );
    if (!created?.id || created.id <= 0) throw new Error("Could not create the user");
    userIdentityOps.link(created.id, {
      providerType: PROVIDER,
      providerKey: KEY,
      subject: identity.id,
      displayName: identity.username,
    });
    return userOps.getUserById(created.id);
  })();
  if (!user || user.status !== "active")
    throw new Error("This account has been suspended or disabled");
  if (!linked && reconcileLocalNetworkBypassSetting().changed)
    websocketService.reconcileAuthState();
  const resolved = toResolvedUser(user);
  if (!resolved) throw new Error("Could not load the Plex user");
  return {
    done: true as const,
    linked: false as const,
    ...createSession(user.id, ip, userAgent),
    user: resolved,
  };
}
