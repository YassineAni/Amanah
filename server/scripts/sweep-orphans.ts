import "../src/loadEnv.js";
import { sweepOrphans } from "../src/storage/audio.js";

const { deleted } = await sweepOrphans(24);
console.log(`sweep-orphans: removed ${deleted} unreferenced audio object(s)`);
process.exit(0);
