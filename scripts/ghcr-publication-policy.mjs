import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const GHCR_PUBLISH_WORKFLOW = ".github/workflows/publish-ghcr.yml";

export const GHCR_ARTIFACT_FILES = Object.freeze([
  "Dockerfile",
  ".dockerignore",
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "scripts/build.mjs",
  "scripts/release-version-policy.mjs",
  "scripts/ghcr-manifest-policy.mjs",
  "scripts/ghcr-retention-policy.mjs",
]);

const ARTIFACT_FILE_SET = new Set(GHCR_ARTIFACT_FILES);
const SOURCE_PREFIX = "src/";

export function parseNullSeparatedPaths(value) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  return text.split("\0").filter(Boolean);
}

function changedPatchContentLines(patch) {
  return patch
    .split(/\r?\n/u)
    .filter(
      (line) =>
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---")),
    )
    .map((line) => line.slice(1));
}

export function isMechanicalActionUsesOnlyChange(patch) {
  const changedLines = changedPatchContentLines(patch);
  return (
    changedLines.length > 0 &&
    changedLines.every((line) => /^\s*uses:\s+\S+/u.test(line))
  );
}

export function requiresGhcrPublication(paths, publishWorkflowPatch = "") {
  if (
    paths.some(
      (path) =>
        path.startsWith(SOURCE_PREFIX) || ARTIFACT_FILE_SET.has(path),
    )
  ) {
    return true;
  }

  if (!paths.includes(GHCR_PUBLISH_WORKFLOW)) {
    return false;
  }

  return !isMechanicalActionUsesOnlyChange(publishWorkflowPatch);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const changedPathsFile = process.argv[2];
  const publishWorkflowPatchFile = process.argv[3];

  if (!changedPathsFile || !publishWorkflowPatchFile) {
    console.error(
      "Usage: node scripts/ghcr-publication-policy.mjs <changed-paths-nul-file> <publish-workflow-patch-file>",
    );
    process.exitCode = 2;
  } else {
    const paths = parseNullSeparatedPaths(readFileSync(changedPathsFile));
    const patch = readFileSync(publishWorkflowPatchFile, "utf8");
    const required = requiresGhcrPublication(paths, patch);
    process.stdout.write(required ? "true\n" : "false\n");
  }
}
