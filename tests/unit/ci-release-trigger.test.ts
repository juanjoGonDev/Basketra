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

test("publication consumes protected main pushes and classifies impact before writes", () => {
  assert.match(publishWorkflow, /push:\n\s+branches:\n\s+- main/u);
  assert.match(publishWorkflow, /VALIDATED_SHA: \$\{\{ github\.sha \}\}/u);
  assert.doesNotMatch(publishWorkflow, /workflow_run:/u);
  assert.doesNotMatch(publishWorkflow, /github\.event\.workflow_run/u);

  const classifyIndex = publishWorkflow.indexOf("  classify:");
  const publishIndex = publishWorkflow.indexOf("  publish-image:");
  const releaseIndex = publishWorkflow.indexOf(
    "- name: Resolve deterministic patch release",
  );
  assert.ok(classifyIndex >= 0);
  assert.ok(publishIndex > classifyIndex);
  assert.ok(releaseIndex > publishIndex);

  assert.match(
    publishWorkflow,
    /classify:\n\s+name: "🔎 Classify GHCR impact"[\s\S]*?permissions:\n\s+contents: read/u,
  );
  assert.match(
    publishWorkflow,
    /ref: \$\{\{ github\.sha \}\}\n\s+fetch-depth: 0/u,
  );
  assert.match(publishWorkflow, /BEFORE_SHA: \$\{\{ github\.event\.before \}\}/u);
  assert.match(publishWorkflow, /HEAD_SHA: \$\{\{ github\.sha \}\}/u);
  assert.match(
    publishWorkflow,
    /git diff --name-only -z "\$BEFORE_SHA" "\$HEAD_SHA" -- > "\$changed_paths"/u,
  );
  assert.match(
    publishWorkflow,
    /git diff --unified=0 --no-ext-diff "\$BEFORE_SHA" "\$HEAD_SHA" -- \\\n\s+\.github\/workflows\/publish-ghcr\.yml > "\$publish_patch"/u,
  );
  assert.match(
    publishWorkflow,
    /node scripts\/ghcr-publication-policy\.mjs "\$changed_paths" "\$publish_patch"/u,
  );
});

test("GHCR publication gates the complete privileged publisher on one classifier output", () => {
  assert.match(
    publishWorkflow,
    /publish-image:\n\s+name: "🚀 Publish verified private GHCR image and release"\n\s+needs: classify\n\s+if: needs\.classify\.outputs\.required == 'true'/u,
  );

  const publishIndex = publishWorkflow.indexOf("  publish-image:");
  for (const step of [
    "Resolve deterministic patch release",
    "Log in to GHCR",
    "Set up QEMU",
    "Set up Buildx",
    "Publish immutable SHA candidate",
    "Promote verified digest to stable",
    "Create or verify GitHub release",
    "Enforce bounded GHCR release retention",
  ]) {
    assert.ok(
      publishWorkflow.indexOf(`- name: ${step}`) > publishIndex,
      `${step} must remain inside the gated publisher`,
    );
  }
});

test("unclassifiable protected-main pushes fail safe to publication", () => {
  assert.match(
    publishWorkflow,
    /if \[\[ "\$BEFORE_SHA" =~ \^0\+\$ \]\] \|\| ! git cat-file -e "\$BEFORE_SHA\^\{commit\}"; then/u,
  );
  assert.match(
    publishWorkflow,
    /echo "required=true" >> "\$GITHUB_OUTPUT"/u,
  );
  assert.match(
    publishWorkflow,
    /GHCR publication required: previous main SHA is unavailable; failing safe/u,
  );
});
