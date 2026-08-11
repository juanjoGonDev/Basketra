import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const publishWorkflow = readFileSync(
  ".github/workflows/publish-ghcr.yml",
  "utf8",
);

test("quality checks run only on pull requests targeting main", () => {
  assert.match(ciWorkflow, /pull_request:\n\s+branches:\n\s+- main/u);
  assert.doesNotMatch(ciWorkflow, /\n  push:/u);
});

test("publication consumes the protected main push directly", () => {
  assert.match(publishWorkflow, /push:\n\s+branches:\n\s+- main/u);
  assert.match(publishWorkflow, /VALIDATED_SHA: \$\{\{ github\.sha \}\}/u);
  assert.doesNotMatch(publishWorkflow, /workflow_run:/u);
  assert.doesNotMatch(publishWorkflow, /github\.event\.workflow_run/u);
});
