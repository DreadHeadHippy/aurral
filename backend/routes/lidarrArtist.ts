import { Hono } from "hono";
import * as v from "valibot";
import { requireAuth, requirePermission } from "../middleware/guards.ts";
import type { AppEnv } from "../middleware/requestUser.ts";
import { validate } from "../middleware/validate.ts";
import { addArtistToLidarr } from "../services/lidarrArtist.ts";
import { logger } from "../services/logger.ts";

export default new Hono<AppEnv>()
  .basePath("/lidarr-artist")
  .post(
    "/",
    requireAuth,
    requirePermission("addArtist"),
    validate("json", v.object({ mbid: v.pipe(v.string(), v.uuid()) })),
    async (c) => {
      try {
        return c.json(await addArtistToLidarr(c.req.valid("json").mbid), 200);
      } catch (error) {
        logger.warn("lidarr", "Could not add artist to Lidarr", { message: String(error) });
        return c.json(
          { error: error instanceof Error ? error.message : "Could not add artist to Lidarr" },
          502,
        );
      }
    },
  );
