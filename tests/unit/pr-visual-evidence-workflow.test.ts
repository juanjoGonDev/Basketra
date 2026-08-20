import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  ".github/workflows/pr-visual-evidence.yml",
  "utf8",
);

test("visual evidence bounds media converter installation and avoids the flaky Azure mirror", () => {
  assert.match(
    workflow,
    /- name: Install the media converter\n\s+timeout-minutes: 5/u,
  );
  assert.match(workflow, /if ! command -v ffmpeg >\/dev\/null 2>&1; then/u);
  assert.match(workflow, /\/etc\/apt\/apt-mirrors\.txt/u);
  assert.match(
    workflow,
    /http:\/\/azure\.archive\.ubuntu\.com\/ubuntu#https:\/\/archive\.ubuntu\.com\/ubuntu/u,
  );
  assert.match(workflow, /Acquire::Retries=3/u);
  assert.match(workflow, /Acquire::http::Timeout=20/u);
  assert.match(workflow, /Acquire::https::Timeout=20/u);
});

test("visual evidence follows the current automatic receipt flow names", () => {
  assert.doesNotMatch(workflow, /local-OCR-creates|local-OCR-failure/u);
  assert.match(workflow, /imports-without-AI/u);
  assert.match(workflow, /supports-per-image-retry/u);
  assert.match(workflow, /retailer-autofill/u);
  assert.match(workflow, /receipt-auto-review-flow-r/u);
  assert.match(workflow, /12-auto-ocr-review\.png/u);
});

test("visual evidence classifies all current and previous PR paths before privileged work", () => {
  const classifyIndex = workflow.indexOf("classify:");
  const publishIndex = workflow.indexOf("publish:");
  assert.ok(classifyIndex >= 0);
  assert.ok(publishIndex > classifyIndex);
  assert.match(
    workflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u,
  );
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u,
  );
  assert.match(
    workflow,
    /gh api --paginate "repos\/\$REPOSITORY\/pulls\/\$PR_NUMBER\/files\?per_page=100"/u,
  );
  assert.match(
    workflow,
    /--jq '\.\[\] \| \{filename, previous_filename\}' \|\n\s+jq -s '\.' > "\$changed_files"/u,
  );
  assert.match(
    workflow,
    /env -u GH_TOKEN node scripts\/pr-visual-evidence-policy\.mjs "\$changed_files"/u,
  );
  assert.match(workflow, /Visual evidence skipped: no src\/web\/\*\*/u);
});

test("visual evidence gates the privileged publisher as one unit", () => {
  assert.match(
    workflow,
    /publish:\n\s+name: "🖼️ Publish direct PR evidence"\n\s+needs: classify\n\s+if: needs\.classify\.outputs\.required == 'true'/u,
  );

  const publishIndex = workflow.indexOf("  publish:");
  const waitIndex = workflow.indexOf("- name: Wait for the authoritative browser run");
  const downloadIndex = workflow.indexOf("- name: Download browser output for the validated head");
  const mediaIndex = workflow.indexOf("- name: Install the media converter");
  assert.ok(publishIndex >= 0 && waitIndex > publishIndex);
  assert.ok(downloadIndex > waitIndex);
  assert.ok(mediaIndex > downloadIndex);
});

test("visual evidence preserves same-head Quality lookup and fails closed before release and comment mutation", () => {
  assert.match(workflow, /-f head_sha="\$HEAD_SHA"/u);
  assert.match(
    workflow,
    /current_head=\$\(gh api "repos\/\$REPOSITORY\/pulls\/\$PR_NUMBER" --jq '\.head\.sha'\)/u,
  );
  assert.match(
    workflow,
    /if \[ "\$current_head" != "\$HEAD_SHA" \]; then\n\s+echo "Refusing stale visual evidence publication:/u,
  );

  const releaseIndex = workflow.indexOf("gh release delete");
  const firstHeadCheck = workflow.indexOf("current_head=$(gh api");
  const commentMutationIndex = workflow.indexOf("gh api --method PATCH");
  const secondHeadCheck = workflow.indexOf(
    "current_head=$(gh api",
    firstHeadCheck + 1,
  );
  assert.ok(firstHeadCheck >= 0 && firstHeadCheck < releaseIndex);
  assert.ok(secondHeadCheck >= 0 && secondHeadCheck < commentMutationIndex);
});
