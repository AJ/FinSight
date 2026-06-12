import type { RawTextItem } from './extractionTypes';

export const PASSWORD_REASON = {
  NEED_PASSWORD: 1,
  INCORRECT_PASSWORD: 2,
} as const;

export class PDFPasswordError extends Error {
  public readonly code: number;
  constructor(message: string = 'PDF is password protected', code: number = 1) {
    super(message);
    this.name = 'PDFPasswordError';
    this.code = code;
  }
}

export function isPasswordError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  if (err.name === 'PasswordException' || err.name === 'PDFPasswordError') return true;
  if (typeof err.message === 'string' && err.message.toLowerCase().includes('password')) return true;
  return false;
}

/**
 * Stage 1: Extract raw text items from a PDF file.
 * Returns flat array of text items with position data and page numbers.
 */
export async function extractTextItems(
  file: File,
  password?: string,
): Promise<RawTextItem[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const arrayBuffer = await file.arrayBuffer();

  return new Promise<RawTextItem[]>((resolve, reject) => {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });

    loadingTask.onPassword = (
      updateCallback: (nextPassword: string) => void,
      reason: number,
    ) => {
      if (reason === PASSWORD_REASON.NEED_PASSWORD) {
        if (password) {
          updateCallback(password);
        } else {
          loadingTask.destroy().finally(() => {
            reject(new PDFPasswordError('PDF requires a password', PASSWORD_REASON.NEED_PASSWORD));
          });
        }
      } else {
        loadingTask.destroy().finally(() => {
          reject(new PDFPasswordError('Incorrect password', PASSWORD_REASON.INCORRECT_PASSWORD));
        });
      }
    };

    loadingTask.promise
      .then(async (pdf) => {
        const items: RawTextItem[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();

          for (const item of textContent.items) {
            const ti = item as { str?: string; transform?: number[]; width?: number };
            if (!('str' in item) || !('transform' in item)) continue;
            if (typeof ti.str !== 'string' || ti.str.trim().length === 0) continue;

            const x = Math.round(ti.transform![4]);
            items.push({
              text: ti.str.trim(),
              x,
              right: Math.round(x + (ti.width ?? 0)),
              y: Math.round(ti.transform![5]),
              page: i,
            });
          }
        }

        resolve(items);
      })
      .catch(reject);
  });
}
