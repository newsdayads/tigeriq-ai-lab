import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("bootstrap hard-enforces canonical Owner-facing work-item references", async () => {
  const workflow = await readFile(new URL("../bootstrap/02_TIGERIQ_WORKFLOW.md", import.meta.url), "utf8");
  assert.match(workflow, /#<số> - <Tên việc canonical>/);
  assert.match(workflow, /CẤM.*#<số>.*đơn lẻ/);
  assert.match(workflow, /WORK_ITEM_TITLE_UNRESOLVED/);
  assert.match(workflow, /bare Issue\/PR\/Work Order reference phải KHÔNG ĐẠT/);
});
