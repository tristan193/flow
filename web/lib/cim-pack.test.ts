import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CIM_DRIVE_PARENT_ID,
  canonicalDriveFileUrl,
  cimPackPath,
  driveFileIdFromUrl,
  driveFileViewUrl,
  fileNameMatchesDeal,
  isDriveFileUrl,
  isDriveFolderUrl,
  parseCimDealId,
  pickCimPackFile,
  type CimPackFile,
} from "./cim-pack-id.ts";

function file(
  partial: Partial<CimPackFile> & Pick<CimPackFile, "id" | "name">,
): CimPackFile {
  return { mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00.000Z", ...partial };
}

test("parseCimDealId normalizes case and requires TLY-digits", () => {
  assert.equal(parseCimDealId("tly-031"), "TLY-031");
  assert.equal(parseCimDealId("TLY-31"), "TLY-031");
  assert.equal(parseCimDealId("TLY-092"), "TLY-092");
  assert.equal(parseCimDealId("cim-031"), null);
  assert.equal(parseCimDealId("TLY-"), null);
  assert.equal(parseCimDealId("not-a-deal"), null);
  assert.equal(cimPackPath("tly-7"), "/cim/TLY-007");
});

test("fileNameMatchesDeal is a case-insensitive prefix", () => {
  assert.equal(fileNameMatchesDeal("TLY-092 Project Cactus.pdf", "TLY-092"), true);
  assert.equal(fileNameMatchesDeal("tly-092 project cactus.pdf", "tly-092"), true);
  assert.equal(fileNameMatchesDeal("TLY-092ProjectCactus.pdf", "TLY-092"), true);
  assert.equal(fileNameMatchesDeal("Project Cactus TLY-092.pdf", "TLY-092"), false);
  assert.equal(fileNameMatchesDeal("TLY-091 Project Cactus.pdf", "TLY-092"), false);
});

test("pickCimPackFile prefers the newest PDF over folders", () => {
  const picked = pickCimPackFile(
    [
      file({
        id: "folder-new",
        name: "TLY-092 Folder",
        mimeType: "application/vnd.google-apps.folder",
        modifiedTime: "2026-09-01T00:00:00.000Z",
      }),
      file({
        id: "old-pdf",
        name: "TLY-092 old.pdf",
        modifiedTime: "2026-01-01T00:00:00.000Z",
      }),
      file({
        id: "new-pdf",
        name: "TLY-092 Project Cactus.pdf",
        modifiedTime: "2026-08-01T00:00:00.000Z",
      }),
      file({
        id: "docx",
        name: "TLY-092 notes.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        modifiedTime: "2026-08-15T00:00:00.000Z",
      }),
    ],
    "tly-092",
  );
  assert.equal(picked?.id, "new-pdf");
});

test("pickCimPackFile returns null when nothing matches", () => {
  assert.equal(pickCimPackFile([file({ id: "x", name: "TLY-001 other.pdf" })], "TLY-092"), null);
  assert.equal(
    pickCimPackFile(
      [
        file({
          id: "folder",
          name: "TLY-092 only folder",
          mimeType: "application/vnd.google-apps.folder",
        }),
      ],
      "TLY-092",
    ),
    null,
  );
});

test("Drive file URLs are accepted; folder URLs are not", () => {
  const fileUrl = driveFileViewUrl("abc123XYZ");
  assert.equal(isDriveFileUrl(fileUrl), true);
  assert.equal(isDriveFileUrl(`${fileUrl}?usp=sharing`), true);
  assert.equal(isDriveFileUrl("https://drive.google.com/open?id=abc123XYZ"), true);
  assert.equal(isDriveFileUrl("https://drive.google.com/uc?id=abc123XYZ&export=download"), true);
  assert.equal(driveFileIdFromUrl(fileUrl), "abc123XYZ");
  assert.equal(canonicalDriveFileUrl("https://drive.google.com/open?id=abc123XYZ"), fileUrl);

  const folder = `https://drive.google.com/drive/folders/${CIM_DRIVE_PARENT_ID}`;
  assert.equal(isDriveFolderUrl(folder), true);
  assert.equal(isDriveFileUrl(folder), false);
  assert.equal(isDriveFileUrl("https://example.com/file.pdf"), false);
  assert.equal(isDriveFileUrl("/api/next/cim-files/1"), false);
  assert.equal(canonicalDriveFileUrl(folder), null);
});
