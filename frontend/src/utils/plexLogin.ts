import { parseResponse } from "hono/client";
import { authClient } from "./api/clients/auth.ts";

type PlexResult =
  | { done: false }
  | { done: true; linked: true }
  | { done: true; linked: false; token: string };

export function openPlexPopup() {
  const popup = window.open("", "aurral-plex-login", "width=600,height=700");
  if (!popup) throw new Error("Allow pop-ups to sign in with Plex");
  return popup;
}

export async function runPlexLogin(popup: Window, link: boolean): Promise<PlexResult> {
  try {
    const { id, authUrl } = link
      ? await parseResponse(authClient.plex.link.start.$post())
      : await parseResponse(authClient.plex.start.$post());
    popup.location.href = authUrl;
    for (const deadline = Date.now() + 10 * 60_000; Date.now() < deadline;) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const result = link
        ? await parseResponse(authClient.plex.link.finish.$post({ json: { id } }))
        : await parseResponse(authClient.plex.finish.$post({ json: { id } }));
      if (result.done) return result;
      if (popup.closed) throw new Error("The Plex sign-in was closed");
    }
    throw new Error("The Plex sign-in timed out");
  } finally {
    popup.close();
  }
}
