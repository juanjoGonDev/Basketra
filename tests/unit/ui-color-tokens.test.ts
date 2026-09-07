import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const modernCss = readFileSync("src/web/modern.css", "utf8");

test("danger buttons use one semantic foreground token across both color schemes", () => {
  assert.match(
    modernCss,
    /--color-on-error:\s*light-dark\(#ffffff,\s*#690005\);/u,
  );
  assert.equal(modernCss.match(/--color-on-error:/gu)?.length, 1);
  assert.match(
    modernCss,
    /\.button\.danger\s*\{[^}]*color:\s*var\(--color-on-error\);/su,
  );
});

test("manual theme selection pins the browser color scheme while system mode remains adaptive", () => {
  assert.match(modernCss, /:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/su);
  assert.match(modernCss, /:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/su);
  assert.match(modernCss, /:root\[data-theme="system"\]\s*\{\s*color-scheme:\s*light dark;/su);
});
