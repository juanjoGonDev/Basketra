import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  ".github/workflows/pr-visual-evidence.yml",
  "utf8",
);

test("visual evidence bounds media converter installation and avoids the flaky Azure mirror", () => {
  assert.match(workflow, /- name: Install the media converter\n\s+timeout-minutes: 5/u);
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
