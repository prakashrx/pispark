import { expect, test } from "vitest";
import { fileKind, fileSize } from "./file-kinds";

test("a file is shown by what its name says it is", () => {
  expect(fileKind("photo.PNG")).toBe("image");
  expect(fileKind("report.pdf")).toBe("pdf");
  expect(fileKind("notes.md")).toBe("markdown");
  expect(fileKind("data.csv")).toBe("text");
  expect(fileKind("archive.zip")).toBe("other");
  expect(fileSize(512)).toBe("512 B");
  expect(fileSize(12_800)).toBe("13 KB");
  expect(fileSize(3_500_000)).toBe("3.3 MB");
});
