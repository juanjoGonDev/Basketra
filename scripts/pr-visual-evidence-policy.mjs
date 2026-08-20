import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const VISUAL_EVIDENCE_DEPENDENCY_FILES = Object.freeze([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

const DEPENDENCY_FILE_SET = new Set(VISUAL_EVIDENCE_DEPENDENCY_FILES);
const WEB_PREFIX = "src/web/";

export function requiresVisualEvidence(paths) {
  return paths.some((path) =>
    path.startsWith(WEB_PREFIX) || DEPENDENCY_FILE_SET.has(path),
  );
}

function readChangedPaths(filePath) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const changedPathsFile = process.argv[2];
  if (!changedPathsFile) {
    console.error("Usage: node scripts/pr-visual-evidence-policy.mjs <changed-paths-file>");
    process.exitCode = 2;
  } else {
    const required = requiresVisualEvidence(readChangedPaths(changedPathsFile));
    process.stdout.write(required ? "true\n" : "false\n");
  }
}
