import * as v from "valibot";
import { http } from "../../lib/http.ts";
import { activePlugin } from "./plugins/pluginStore.ts";

const artistSchema = v.looseObject({
  foreignArtistId: v.string(),
  id: v.optional(v.number()),
});
const rootSchema = v.looseObject({
  path: v.string(),
  defaultQualityProfileId: v.number(),
  defaultMetadataProfileId: v.number(),
});

export async function addArtistToLidarr(mbid: string) {
  const plugin = activePlugin("lidarr");
  if (!plugin) throw new Error("Enable and configure the Lidarr plugin first");
  const { url, apiKey, rootFolder } = plugin.settings;
  if (typeof url !== "string" || typeof apiKey !== "string" || !url || !apiKey)
    throw new Error("Configure the Lidarr URL and API key in the Lidarr plugin");
  const base = url.replace(/\/+$/, "");
  const options = { headers: { "X-Api-Key": apiKey }, timeoutMs: 30_000 };
  const existing = await http.get(`${base}/api/v1/artist`, {
    ...options,
    query: { mbId: mbid },
  });
  const existingArtists = v.parse(v.array(artistSchema), existing.data);
  if (existingArtists.some((artist) => artist.foreignArtistId === mbid))
    return { alreadyAdded: true };

  const [lookup, roots] = await Promise.all([
    http.get(`${base}/api/v1/artist/lookup`, {
      ...options,
      query: { term: `lidarr:${mbid}` },
    }),
    http.get(`${base}/api/v1/rootfolder`, options),
  ]);
  const artist = v
    .parse(v.array(artistSchema), lookup.data)
    .find((item) => item.foreignArtistId === mbid);
  if (!artist) throw new Error("Lidarr could not find this artist");
  const folders = v.parse(v.array(rootSchema), roots.data);
  const wanted = typeof rootFolder === "string" ? rootFolder.trim().replace(/[\\/]+$/, "") : "";
  const root = wanted
    ? folders.find((folder) => folder.path.replace(/[\\/]+$/, "") === wanted)
    : folders[0];
  if (!root) throw new Error("The Lidarr plugin's root folder was not found");
  await http.post(
    `${base}/api/v1/artist`,
    {
      ...artist,
      monitored: true,
      rootFolderPath: root.path,
      qualityProfileId: root.defaultQualityProfileId,
      metadataProfileId: root.defaultMetadataProfileId,
      addOptions: { monitor: "all", searchForMissingAlbums: true },
    },
    options,
  );
  return { alreadyAdded: false };
}
