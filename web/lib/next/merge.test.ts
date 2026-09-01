import { test } from "node:test";
import assert from "node:assert/strict";

import { duplicateGroups } from "./merge.ts";

test("duplicate groups join on Axial hex nickname and source id", () => {
  const groups = duplicateGroups([
    {
      id: 1,
      deal_number: "TLY-003",
      source_deal_id: "axial:aaaabbbbccccdddd",
      nickname: "aaaabbbbccccdddd",
    },
    {
      id: 2,
      deal_number: "TLY-023",
      source_ids: [
        { kind: "axial", value: "aaaabbbbccccdddd", canonical: "axial:aaaabbbbccccdddd" },
      ],
      nickname: "aaaabbbbccccdddd",
    },
    {
      id: 3,
      deal_number: "TLY-008",
      source_deal_id: "axial:1111222233334444",
    },
    {
      id: 4,
      deal_number: "TLY-001",
      nickname: "Axial",
      title: "Unrelated",
    },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].numbers.sort(), ["TLY-003", "TLY-023"]);
});
