import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const modernCss = readFileSync("src/web/modern.css", "utf8");

test("danger buttons have semantic foreground tokens in both color schemes", () => {
  const definitions = modernCss.match(
    /--color-on-error:\s*#[0-9a-f]{6};/giu,
  );

  assert.equal(definitions?.length, 2);
  assert.match(
    modernCss,
    /\.button\.danger\s*\{[^}]*color:\s*var\(--color-on-error\);/su,
  );
});
