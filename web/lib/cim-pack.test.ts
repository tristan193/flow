import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CIM_DRIVE_PARENT_ID,
  cimDriveConfigured,
  cimPackPath,
  driveFileViewUrl,
  fileNameMatchesDeal,
  lookupCimPack,
  parseCimDealId,
  pickCimPackFile,
  type CimPackFile,
  type DriveFilesClient,
} from "./cim-pack.ts";

function file(
  partial: Partial<CimPackFile> & Pick<CimPackFile, "id" | "name">,
): CimPackFile {
  return { mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00.000Z", ...partial };
}

function mockDrive(
  files: CimPackFile[],
  onCall?: (params: Record<string, unknown>) => void,
): { drive: DriveFilesClient; created: number; calls: string[] } {
  const calls: string[] = [];
  let created = 0;
  const drive: DriveFilesClient = {
    files: {
      list: async (params) => {
        calls.push("list");
        onCall?.(params);
        return { data: { files } };
      },
      create: async () => {
        created += 1;
        calls.push("create");
        throw new Error("files.create must never run on the CIM opener");
      },
    },
  };
  return { drive, created, calls };
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

test("lookupCimPack finds a prefix match and never calls files.create", async () => {
  const { drive, created, calls } = mockDrive([
    file({ id: "abc123", name: "TLY-092 Project Cactus.pdf" }),
  ]);
  const result = await lookupCimPack("tly-092", { drive });
  assert.deepEqual(result, {
    status: "found",
    dealNumber: "TLY-092",
    fileId: "abc123",
    name: "TLY-092 Project Cactus.pdf",
    viewUrl: driveFileViewUrl("abc123"),
  });
  assert.equal(created, 0);
  assert.deepEqual(calls, ["list"]);
  assert.ok(!calls.includes("create"));
});

test("lookupCimPack lists only the shared-drive parent", async () => {
  let params: Record<string, unknown> | null = null;
  const { drive } = mockDrive([], (p) => {
    params = p;
  });
  const result = await lookupCimPack("TLY-031", { drive });
  assert.equal(result.status, "missing");
  assert.ok(params);
  assert.equal(params.corpora, "drive");
  assert.equal(params.driveId, CIM_DRIVE_PARENT_ID);
  assert.equal(params.supportsAllDrives, true);
  assert.equal(params.includeItemsFromAllDrives, true);
  assert.match(String(params.q), new RegExp(`'${CIM_DRIVE_PARENT_ID}' in parents`));
  assert.match(String(params.q), /name contains 'TLY-031'/);
  assert.equal(params.fields, "nextPageToken, files(id, name, mimeType, modifiedTime)");
});

test("lookupCimPack missing file is not a crash", async () => {
  const { drive, created } = mockDrive([]);
  const result = await lookupCimPack("TLY-031", { drive });
  assert.deepEqual(result, { status: "missing", dealNumber: "TLY-031" });
  assert.equal(created, 0);
});

test("lookupCimPack is disconnected when the service account env is missing", async () => {
  const prev = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    const result = await lookupCimPack("TLY-031", { credentialsJson: null });
    assert.equal(result.status, "disconnected");
    assert.equal(cimDriveConfigured(null), false);
    assert.equal(cimDriveConfigured(""), false);
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prev;
  }
});

test("lookupCimPack rejects invalid ids before talking to Drive", async () => {
  let listed = 0;
  const drive: DriveFilesClient = {
    files: {
      list: async () => {
        listed += 1;
        return { data: { files: [] } };
      },
      create: async () => {
        throw new Error("files.create must never run");
      },
    },
  };
  assert.deepEqual(await lookupCimPack("nope", { drive }), { status: "invalid" });
  assert.equal(listed, 0);
});
