import fs from "node:fs";
import path from "node:path";
import type { DistillationProfile } from "../src/shared/types";

export function distillationPath(projectRoot: string) {
  return path.join(projectRoot, "data", "processed", "chai-distillation.json");
}

export function loadDistillation(projectRoot: string) {
  try {
    return JSON.parse(fs.readFileSync(distillationPath(projectRoot), "utf8")) as DistillationProfile;
  } catch {
    return null;
  }
}
