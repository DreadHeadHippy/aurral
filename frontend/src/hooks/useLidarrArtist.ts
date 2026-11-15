import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { API_BASE_URL, apiFetch, asApiError } from "../utils/api/core.ts";

export function useLidarrArtist(mbid: string | null | undefined, name: string) {
  const [pending, setPending] = useState(false);
  const { hasPermission } = useAuth();
  const { showSuccess, showError } = useToast();
  const canAdd = Boolean(mbid && hasPermission("addArtist"));
  const add = async () => {
    if (!mbid || pending || !canAdd) return;
    setPending(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/lidarr-artist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mbid }),
      });
      const result: { alreadyAdded: boolean } = await response.json();
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
