import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("styles: themed overlays do not intercept clicks", () => {
  const layoutCss = readFileSync(resolve(process.cwd(), "src/renderer/styles/layout.css"), "utf8");
  const gameCss = readFileSync(resolve(process.cwd(), "src/renderer/styles/game.css"), "utf8");

  assert.match(layoutCss, /\.screen-themed::before\s*\{[\s\S]*pointer-events:\s*none;/);
  assert.match(gameCss, /\.arena-board::before\s*\{[\s\S]*pointer-events:\s*none;/);
});

test("styles: themed interactive panel layers are explicitly above visual overlays", () => {
  const layoutCss = readFileSync(resolve(process.cwd(), "src/renderer/styles/layout.css"), "utf8");

  assert.match(layoutCss, /\.themed-screen-panel\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*1;/);
  assert.match(layoutCss, /\.viewed-profile-content\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*1;/);
});

