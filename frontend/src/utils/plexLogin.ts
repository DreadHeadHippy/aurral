import { API_BASE_URL, apiFetch } from "./api/core.ts";

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
  const path = link ? "/auth/plex/link" : "/auth/plex";
  try {
    const start = await apiFetch(`${API_BASE_URL}${path}/start`, { method: "POST" });
    const { id, authUrl }: { id: string; authUrl: string } = await start.json();
    popup.location.href = authUrl;
    for (const deadline = Date.now() + 10 * 60_000; Date.now() < deadline;) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const response = await apiFetch(`${API_BASE_URL}${path}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result: PlexResult = await response.json();
      if (result.done) return result;
      if (popup.closed) throw new Error("The Plex sign-in was closed");
    }
    throw new Error("The Plex sign-in timed out");
  } finally {
    popup.close();
  }
}
