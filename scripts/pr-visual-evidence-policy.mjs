import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const VISUAL_EVIDENCE_DEPENDENCY_FILES = Object.freeze([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

const DEPENDENCY_FILE_SET = new Set(VISUAL_EVIDENCE_DEPENDENCY_FILES);
const WEB_PREFIX = "src/web/";

export function pullRequestFilePaths(files) {
  const paths = [];
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    if (typeof file.filename === "string") paths.push(file.filename);
    if (typeof file.previous_filename === "string") {
      paths.push(file.previous_filename);
    }
  }
  return paths;
}

export function requiresVisualEvidence(paths) {
  return paths.some(
    (path) => path.startsWith(WEB_PREFIX) || DEPENDENCY_FILE_SET.has(path),
  );
}

function readPullRequestFiles(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new TypeError("Pull request file metadata must be a JSON array");
  }
  return parsed;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const changedFilesPath = process.argv[2];
  if (!changedFilesPath) {
    console.error(
      "Usage: node scripts/pr-visual-evidence-policy.mjs <pr-files-json>",
    );
    process.exitCode = 2;
  } else {
    const paths = pullRequestFilePaths(readPullRequestFiles(changedFilesPath));
    process.stdout.write(requiresVisualEvidence(paths) ? "true\n" : "false\n");
  }
}
