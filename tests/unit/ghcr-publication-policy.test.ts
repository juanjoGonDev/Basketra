import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GHCR_ARTIFACT_FILES,
  GHCR_PUBLISH_WORKFLOW,
  isMechanicalActionUsesOnlyChange,
  requiresGhcrPublication,
} from "../../scripts/ghcr-publication-policy.mjs";

const RUN_PATHS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["backend source", ["src/main.ts"]],
  ["rendered frontend", ["src/web/app.js"]],
  ["Dockerfile", ["Dockerfile"]],
  ["Docker build context policy", [".dockerignore"]],
  ["package manifest", ["package.json"]],
  ["typecheck config used by the build", ["tsconfig.json"]],
  ["production compile config", ["tsconfig.build.json"]],
  ["production build script", ["scripts/build.mjs"]],
  ["release version policy", ["scripts/release-version-policy.mjs"]],
  ["GHCR manifest policy", ["scripts/ghcr-manifest-policy.mjs"]],
  ["GHCR retention policy", ["scripts/ghcr-retention-policy.mjs"]],
  [
    "runtime source mixed with action workflow updates",
    [".github/workflows/ci.yml", "src/api/server.ts"],
  ],
];

const SKIP_PATHS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["visual evidence workflow", [".github/workflows/pr-visual-evidence.yml"]],
  ["other Actions workflow", [".github/workflows/codeql.yml"]],
  ["tests", ["tests/unit/ghcr-manifest-policy.test.ts"]],
  ["agent specs", [".agents/specs/example.md"]],
  ["documentation", ["README.md", "docs/adr/example.md"]],
  ["Compose only", ["compose.yml", "compose.remote.yml"]],
  ["repository maintenance", [".gitignore", "lefthook.yml"]],
  ["pnpm lockfile", ["pnpm-lock.yaml"]],
  ["pnpm workspace manifest", ["pnpm-workspace.yaml"]],
  [
    "PR 33 shaped CI-only set",
    [
      ".agents/specs/2026-08-20-visual-evidence-impact-policy.md",
      ".github/workflows/pr-visual-evidence.yml",
      "scripts/pr-visual-evidence-policy.mjs",
      "tests/unit/pr-visual-evidence-policy.test.ts",
      "tests/unit/pr-visual-evidence-workflow.test.ts",
    ],
  ],
];

const ACTION_PIN_PATCH = `@@ -49,7 +49,7 @@ jobs:\n-        uses: docker/login-action@371161bbe7024a29a25c5e19bfcbc0804fe9ad2c # v4.5.2\n+        uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0\n`;

const SUBSTANTIVE_PUBLISH_PATCH = `@@ -1,5 +1,7 @@\n name: Publish verified private GHCR image and release\n+run-name: Publish validated Basketra image\n on:\n   push:\n`;

test("GHCR artifact files explicitly match the current Docker and publication inputs", () => {
  assert.deepEqual([...GHCR_ARTIFACT_FILES], [
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
  assert.equal(GHCR_PUBLISH_WORKFLOW, ".github/workflows/publish-ghcr.yml");
});

for (const [name, paths] of RUN_PATHS) {
  test(`GHCR publication runs for ${name}`, () => {
    assert.equal(requiresGhcrPublication(paths), true);
  });
}

for (const [name, paths] of SKIP_PATHS) {
  test(`GHCR publication skips ${name}`, () => {
    assert.equal(requiresGhcrPublication(paths), false);
  });
}

test("mechanical GitHub Actions pin updates are recognized from diff content", () => {
  assert.equal(isMechanicalActionUsesOnlyChange(ACTION_PIN_PATCH), true);
  assert.equal(
    requiresGhcrPublication([GHCR_PUBLISH_WORKFLOW], ACTION_PIN_PATCH),
    false,
  );
});

test("substantive publication workflow changes require GHCR", () => {
  assert.equal(isMechanicalActionUsesOnlyChange(SUBSTANTIVE_PUBLISH_PATCH), false);
  assert.equal(
    requiresGhcrPublication(
      [GHCR_PUBLISH_WORKFLOW],
      SUBSTANTIVE_PUBLISH_PATCH,
    ),
    true,
  );
});

test("empty or metadata-only publish workflow patches fail safe to RUN", () => {
  assert.equal(isMechanicalActionUsesOnlyChange(""), false);
  assert.equal(requiresGhcrPublication([GHCR_PUBLISH_WORKFLOW], ""), true);
  assert.equal(
    requiresGhcrPublication(
      [GHCR_PUBLISH_WORKFLOW],
      "diff --git a/file b/file\nindex 123..456 100644\n",
    ),
    true,
  );
});

test("runtime impact wins over a simultaneous mechanical action update", () => {
  assert.equal(
    requiresGhcrPublication(
      [GHCR_PUBLISH_WORKFLOW, "src/web/app.js"],
      ACTION_PIN_PATCH,
    ),
    true,
  );
});

test("action-only updates across multiple workflows remain SKIP", () => {
  assert.equal(
    requiresGhcrPublication(
      [GHCR_PUBLISH_WORKFLOW, ".github/workflows/codeql.yml"],
      ACTION_PIN_PATCH,
    ),
    false,
  );
});

test("Docker dependency updates remain RUN because Dockerfile changes the image", () => {
  assert.equal(
    requiresGhcrPublication(["Dockerfile"], "-FROM node:22\n+FROM node:23\n"),
    true,
  );
});
