import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VISUAL_EVIDENCE_DEPENDENCY_FILES,
  requiresVisualEvidence,
} from "../../scripts/pr-visual-evidence-policy.mjs";

const RUN_CASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["web JavaScript", ["src/web/app.js"]],
  ["web CSS", ["src/web/modern.css"]],
  ["web UI source", ["src/web/ui.js"]],
  ["new web component", ["src/web/new-component.js"]],
  ["deleted web source", ["src/web/removed-component.js"]],
  [
    "web file renamed outside the web tree",
    ["docs/archive/legacy.css", "src/web/legacy.css"],
  ],
  ["package manifest", ["package.json"]],
  ["pnpm lockfile", ["pnpm-lock.yaml"]],
  ["pnpm workspace manifest", ["pnpm-workspace.yaml"]],
  [
    "dependency manifest mixed with workflow changes",
    [".github/workflows/ci.yml", "package.json"],
  ],
  [
    "web source mixed with workflow changes",
    [".github/workflows/pr-quality.yml", "src/web/ui.js"],
  ],
  [
    "triggering path mixed with non-triggering paths",
    ["README.md", "tests/browser/ui-design.spec.mjs", "src/web/icon.svg"],
  ],
];

const SKIP_CASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["visual evidence workflow only", [".github/workflows/pr-visual-evidence.yml"]],
  ["tests only", ["tests/browser/ui-design.spec.mjs"]],
  ["agent specs only", [".agents/specs/example.md"]],
  ["documentation only", ["README.md", "docs/adr/0001-modular-monolith.md"]],
  ["backend source only", ["src/api/server.ts", "src/domain/money.ts"]],
  ["Docker and Compose only", ["Dockerfile", "compose.yml"]],
  [
    "GitHub configuration plus tests only",
    [".github/dependabot.yml", "tests/unit/pr-visual-evidence-workflow.test.ts"],
  ],
  ["repository maintenance only", [".gitignore", "lefthook.yml"]],
];

test("visual evidence dependency files are explicit Basketra owners", () => {
  assert.deepEqual([...VISUAL_EVIDENCE_DEPENDENCY_FILES], [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]);
});

for (const [name, paths] of RUN_CASES) {
  test(`visual evidence runs for ${name}`, () => {
    assert.equal(requiresVisualEvidence(paths), true);
  });
}

for (const [name, paths] of SKIP_CASES) {
  test(`visual evidence skips ${name}`, () => {
    assert.equal(requiresVisualEvidence(paths), false);
  });
}

test("visual evidence skips an empty changed-file set", () => {
  assert.equal(requiresVisualEvidence([]), false);
});
