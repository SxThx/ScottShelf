import "dotenv/config";
import { initializeMetadataTables, refreshAllStoredMetadata, refreshMetadataById } from "../src/metadata";

const concurrency = Number(process.env.METADATA_BACKFILL_CONCURRENCY ?? 2);
const limit = Number(process.env.METADATA_BACKFILL_LIMIT ?? 0);
const mangaUpdatesId = process.env.METADATA_BACKFILL_ID;

initializeMetadataTables()
  .then(() => mangaUpdatesId ? refreshMetadataById(mangaUpdatesId).then(() => ({ total: 1, refreshed: 1, failed: 0 })) : refreshAllStoredMetadata({ concurrency, limit }))
  .then((result) => {
    console.log(
      `Metadata backfill complete: refreshed=${result.refreshed} failed=${result.failed} total=${result.total}`
    );
    process.exit(result.failed ? 1 : 0);
  })
  .catch((error: Error) => {
    console.error("Metadata backfill failed:", error.message);
    process.exit(1);
  });
