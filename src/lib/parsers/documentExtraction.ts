import { debugError, debugLog } from "@/lib/utils/debug";

export function isPasswordError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as Record<string, unknown>;
  debugError("[documentExtraction][Password Error Detection] Checking error:", err);

  if (err.name === "PasswordException") return true;

  if (
    typeof err.message === "string" &&
    err.message.toLowerCase().includes("password")
  ) {
    return true;
  }

  if (err.code === 1 || err.code === 2) return true;

  return false;
}

export class PDFPasswordError extends Error {
  public readonly code: number;

  constructor(message: string = "PDF is password protected", code: number = 1) {
    super(message);
    this.name = "PDFPasswordError";
    this.code = code;
  }
}

export const PASSWORD_REASON = {
  NEED_PASSWORD: 1,
  INCORRECT_PASSWORD: 2,
} as const;

export async function extractTextFromPDF(
  file: File,
  password?: string,
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const arrayBuffer = await file.arrayBuffer();

  return new Promise((resolve, reject) => {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });

    loadingTask.onPassword = (
      updateCallback: (nextPassword: string) => void,
      reason: number,
    ) => {
      debugLog("[documentExtraction][onPassword] reason:", reason, "password provided:", !!password);
      if (reason === PASSWORD_REASON.NEED_PASSWORD) {
        if (password) {
          updateCallback(password);
          debugLog("[documentExtraction][onPassword] updateCallback called");
        } else {
          loadingTask.destroy().finally(() => {
            reject(new PDFPasswordError("PDF requires a password", PASSWORD_REASON.NEED_PASSWORD));
          });
        }
      } else {
        debugLog("[documentExtraction][onPassword] incorrect password");
        loadingTask.destroy().finally(() => {
          reject(new PDFPasswordError("Incorrect password", PASSWORD_REASON.INCORRECT_PASSWORD));
        });
      }
    };

    loadingTask.promise
      .then(async (pdf) => {
        let fullText = "";

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();

          const items = textContent.items
            .filter(
              (item) =>
                "str" in item &&
                "transform" in item &&
                typeof (item as { str: string }).str === "string" &&
                (item as { str: string }).str.trim().length > 0,
            )
            .map((item) => {
              const textItem = item as { str: string; transform: number[] };
              return {
                text: textItem.str.trim(),
                x: Math.round(textItem.transform[4]),
                y: Math.round(textItem.transform[5]),
              };
            });

          const lines: { y: number; items: { text: string; x: number }[] }[] = [];
          for (const item of items) {
            const existing = lines.find((line) => Math.abs(line.y - item.y) < 3);
            if (existing) {
              existing.items.push(item);
            } else {
              lines.push({ y: item.y, items: [item] });
            }
          }

          lines.sort((a, b) => b.y - a.y);
          for (const line of lines) {
            line.items.sort((a, b) => a.x - b.x);
            let prev = 0;
            const parts: string[] = [];
            for (const item of line.items) {
              if (prev > 0 && item.x - prev > 50) {
                parts.push("\t");
              }
              parts.push(item.text);
              prev = item.x + item.text.length * 5;
            }
            fullText += `${parts.join(" ")}\n`;
          }
          fullText += "\n--- PAGE BREAK ---\n\n";
        }

        resolve(fullText);
      })
      .catch((err: unknown) => {
        reject(err);
      });
  });
}

export async function extractTextFromTabular(file: File): Promise<string> {
  const ext = file.name.toLowerCase();

  if (ext.endsWith(".csv")) {
    return file.text();
  }

  const XLSX = await import("xlsx");
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  let text = "";
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    text += `Sheet: ${sheetName}\n${csv}\n\n`;
  }
  return text;
}
