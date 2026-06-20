/**
 * One-time warm-up: create (or reuse) the Runway custom anchor avatar from
 * brand/anchor.png and print its id. Caches to brand/.anchor-avatar.json so
 * final-tier jobs reuse it. Usage: `npm run build:avatar`
 */
import { ensureAnchorAvatar } from "@/lib/runway";

ensureAnchorAvatar()
  .then((id) => console.log("anchor avatar ready:", id))
  .catch((err) => {
    console.error("avatar build failed:", err.message);
    process.exit(1);
  });
