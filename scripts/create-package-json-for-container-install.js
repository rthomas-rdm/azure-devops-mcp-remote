#!/usr/bin/env node
/**
 * Build a container-friendly package.container.json:
 * - copies everything from package.json
 * - replaces "scripts" with ONLY "preinstall" (if present), removing the prebuild script that would fail trying to run husky hooks
 */

import fs from "fs";
import path from "path";

function buildContainerPackageJson({ source = "package.json", target = "package.container.json" } = {}) {
  const sourcePath = path.resolve(process.cwd(), source);
  const targetPath = path.resolve(process.cwd(), target);

  const pkg = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

  const preinstall = pkg.scripts?.preinstall;

  // Keep only preinstall under scripts (or remove scripts entirely if none)
  if (preinstall) {
    pkg.scripts = { preinstall };
  } else {
    delete pkg.scripts;
  }

  fs.writeFileSync(targetPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log(`Wrote ${target} (scripts: ${preinstall ? "preinstall only" : "removed"})`);
}

try {
  buildContainerPackageJson();
} catch (err) {
  console.error("Failed to build package.container.json:");
  console.error(err);
  process.exit(1);
}
