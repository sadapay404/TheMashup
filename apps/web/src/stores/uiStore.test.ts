/**
 * UI store section history (Android back button navigation).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { useUIStore } from "./uiStore";

function reset(): void {
  useUIStore.setState({ page: "home", pageHistory: [] });
}

test("setPage pushes previous section onto history (dedupes same-page)", () => {
  reset();
  const ui = useUIStore.getState();
  ui.setPage("search");
  ui.setPage("search"); // no-op → no duplicate history entry
  ui.setPage("library");
  const s = useUIStore.getState();
  assert.equal(s.page, "library");
  assert.deepEqual(s.pageHistory, ["home", "search"]);
});

test("backPage pops history and reports emptiness", () => {
  reset();
  const ui = useUIStore.getState();
  assert.equal(ui.backPage(), false); // empty at home
  ui.setPage("downloads");
  ui.setPage("search");
  assert.equal(useUIStore.getState().backPage(), true); // → downloads
  assert.equal(useUIStore.getState().page, "downloads");
  assert.equal(useUIStore.getState().backPage(), true); // → home
  assert.equal(useUIStore.getState().page, "home");
  assert.equal(useUIStore.getState().backPage(), false); // nothing left
});

test("goHome jumps home and clears history (double back press)", () => {
  reset();
  const ui = useUIStore.getState();
  ui.setPage("search");
  ui.setPage("library");
  ui.goHome();
  const s = useUIStore.getState();
  assert.equal(s.page, "home");
  assert.deepEqual(s.pageHistory, []);
  assert.equal(s.backPage(), false);
});

test("history is capped so deep chains cannot grow unbounded", () => {
  reset();
  const ui = useUIStore.getState();
  const pages = ["search", "library", "downloads"] as const;
  for (let i = 0; i < 40; i++) ui.setPage(pages[i % 3]!);
  assert.ok(useUIStore.getState().pageHistory.length <= 30);
});
