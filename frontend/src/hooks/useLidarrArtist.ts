import { useState } from "react";
import { hc, parseResponse } from "hono/client";
import type lidarrArtist from "../../../backend/routes/lidarrArtist.ts";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { API_BASE_URL, apiFetch, asApiError } from "../utils/api/core.ts";

const lidarrClient = hc<typeof lidarrArtist>(API_BASE_URL, { fetch: apiFetch })["lidarr-artist"];

export function useLidarrArtist(mbid: string | null | undefined, name: string) {
  const [pending, setPending] = useState(false);
  const { hasPermission } = useAuth();
  const { showSuccess, showError } = useToast();
  const canAdd = Boolean(mbid && hasPermission("addArtist"));
  const add = async () => {
    if (!mbid || pending || !canAdd) return;
    setPending(true);
    try {
      const result = await parseResponse(lidarrClient.$post({ json: { mbid } }));
      showSuccess(result.alreadyAdded ? `${name} is already in Lidarr` : `Added ${name} to Lidarr`);
    } catch (error) {
      const data = asApiError(error)?.response?.data;
      showError(
        typeof data === "object" && data && typeof data.error === "string"
          ? data.error
          : `Could not add ${name} to Lidarr`,
      );
    } finally {
      setPending(false);
    }
  };
  return { add, canAdd, pending };
}
