import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusProfile } from "../src/shared/types";
import { writeTargetOutputs } from "./target-outputs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
const outputs = writeTargetOutputs(profile, projectRoot);

console.log(`Exported ${outputs.count} target records`);
console.log(outputs.markdownPath);
console.log(outputs.csvPath);
