import { tmpdir } from "node:os";
import type { Page } from "@playwright/test";

/** A second existing folder on the test host, typed under "Another folder" in Ask. */
export const otherFolder = tmpdir();
export const otherFolderLabel = `Working folder: ${otherFolder}`;
export const folderButton = (page: Page) =>
  page.getByRole("button", { name: /^Working folder:/ });

/** Choose another working folder the way a person would: type its path and press Enter. */
export async function useFolder(page: Page, folder = otherFolder) {
  await folderButton(page).click();
  await page.getByRole("textbox", { name: "Another folder" }).fill(folder);
  await page.keyboard.press("Enter");
}
