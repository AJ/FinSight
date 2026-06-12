// Re-exports from the extraction pipeline.
// The PDF extraction logic now lives in src/lib/parsers/extraction/.

export {
  extractTextFromPDF,
  PDFPasswordError,
  PASSWORD_REASON,
  isPasswordError,
} from './extraction/pdfExtractionPipeline';

export async function extractTextFromTabular(file: File): Promise<string> {
  const ext = file.name.toLowerCase();

  if (ext.endsWith('.csv')) {
    return file.text();
  }

  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  let text = '';
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    text += `Sheet: ${sheetName}\n${csv}\n\n`;
  }
  return text;
}
