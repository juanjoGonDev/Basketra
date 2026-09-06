import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  ".github/workflows/pr-visual-evidence.yml",
  "utf8",
);

test("visual evidence starts only after the authoritative pull-request quality workflow completes", () => {
  assert.match(workflow, /workflow_run:\n\s+workflows:\n\s+- Pull Request Quality\n\s+types:\n\s+- completed/u);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'pull_request'/u);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/u);
  assert.doesNotMatch(workflow, /Wait for the authoritative browser run|sleep 15|for attempt in \$\(seq 1 80\)/u);
});

test("visual evidence resolves the exact same-repository trusted PR using default-branch policy code", () => {
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/u);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(workflow, /repos\/\$REPOSITORY\/commits\/\$HEAD_SHA\/pulls\?per_page=100/u);
  assert.match(workflow, /\.head\.repo\.full_name == \$repository/u);
  assert.match(workflow, /OWNER\|MEMBER\|COLLABORATOR/u);
  assert.match(workflow, /Expected exactly one open same-repository PR/u);
  assert.match(workflow, /current_head=\$\(gh api "repos\/\$REPOSITORY\/pulls\/\$pr_number" --jq '\.head\.sha'\)/u);
});

test("visual evidence classifies all current and previous PR paths before write-capable work", () => {
  const classifyIndex = workflow.indexOf("  classify:");
  const prepareIndex = workflow.indexOf("  prepare:");
  const publishIndex = workflow.indexOf("  publish:");
  assert.ok(classifyIndex >= 0 && prepareIndex > classifyIndex && publishIndex > prepareIndex);
  assert.match(workflow, /gh api --paginate "repos\/\$REPOSITORY\/pulls\/\$PR_NUMBER\/files\?per_page=100"/u);
  assert.ok(workflow.includes("--jq '.[] | {filename, previous_filename}' | \\\n            jq -s '.' > \"$changed_files\""));
  assert.match(workflow, /env -u GH_TOKEN node scripts\/pr-visual-evidence-policy\.mjs "\$changed_files"/u);
  assert.match(workflow, /Visual evidence skipped: no src\/web\/\*\*/u);
});

test("visual preparation is read-only, one-minute bounded and consumes all Browser shards", () => {
  const prepareStart = workflow.indexOf("  prepare:");
  const publishStart = workflow.indexOf("  publish:");
  const prepare = workflow.slice(prepareStart, publishStart);
  assert.match(prepare, /timeout-minutes: 1/u);
  assert.match(prepare, /permissions:\n\s+actions: read\n\s+contents: read/u);
  assert.doesNotMatch(prepare, /contents: write|pull-requests: write|issues: write/u);
  assert.match(prepare, /--pattern 'basketra-browser-shard-\*'/u);
  assert.match(prepare, /find downloaded -type d -name "\*\$needle\*"/u);
  assert.match(prepare, /Browser evidence must not contain symbolic links/u);
  assert.match(prepare, /name: basketra-prepared-visual-evidence/u);
});

test("visual evidence keeps bounded media conversion and current evidence selectors", () => {
  assert.match(workflow, /- name: Install the media converter\n\s+timeout-minutes: 1/u);
  assert.match(workflow, /if ! command -v ffmpeg >\/dev\/null 2>&1; then/u);
  assert.match(workflow, /Acquire::Retries=3/u);
  assert.doesNotMatch(workflow, /local-OCR-creates|local-OCR-failure/u);
  assert.match(workflow, /imports-without-AI/u);
  assert.match(workflow, /supports-per-image-retry/u);
  assert.match(workflow, /prepare_unique_flow retailer-confirmed\.png 12-ocr-retailer/u);
  assert.match(workflow, /receipt-auto-review-flow-r/u);
  assert.match(workflow, /12-auto-ocr-review\.png/u);
});

test("the only write-capable visual job consumes prepared data and revalidates head before mutations", () => {
  const publishStart = workflow.indexOf("  publish:");
  const publish = workflow.slice(publishStart);
  assert.match(publish, /timeout-minutes: 1/u);
  assert.match(publish, /contents: write/u);
  assert.match(publish, /pull-requests: write/u);
  assert.match(publish, /--name basketra-prepared-visual-evidence/u);
  assert.doesNotMatch(publish, /actions\/checkout|scripts\/pr-visual-evidence-policy|ffmpeg/u);

  const releaseIndex = publish.indexOf("gh release delete");
  const firstHeadCheck = publish.indexOf("current_head=$(gh api");
  const commentMutationIndex = publish.indexOf("gh api --method PATCH");
  const secondHeadCheck = publish.indexOf("current_head=$(gh api", firstHeadCheck + 1);
  assert.ok(firstHeadCheck >= 0 && firstHeadCheck < releaseIndex);
  assert.ok(secondHeadCheck >= 0 && secondHeadCheck < commentMutationIndex);
});
