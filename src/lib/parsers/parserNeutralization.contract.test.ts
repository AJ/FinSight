import type { ExtractionBundle } from './contracts';
import { parseCSV } from './csvParser';
import { parseXLS } from './xlsParser';
import { processStatement } from './pipeline';
import { attachVerificationToExtractionBundle } from '@/lib/services/statementVerificationService';

type Assert<T extends true> = T;
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

type CSVBundle = Awaited<ReturnType<typeof parseCSV>>;
type XLSBundle = Awaited<ReturnType<typeof parseXLS>>;
type ProcessStatementData = Awaited<ReturnType<typeof processStatement>>['data'];
type VerifiedBundle = ReturnType<typeof attachVerificationToExtractionBundle>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Type-level assertions only
type __csvReturnsExtractionBundle = Assert<IsExact<CSVBundle, ExtractionBundle>>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Type-level assertions only
type __xlsReturnsExtractionBundle = Assert<IsExact<XLSBundle, ExtractionBundle>>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Type-level assertions only
type __processStatementReturnsExtractionBundle = Assert<IsExact<ProcessStatementData, ExtractionBundle | null>>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Type-level assertions only
type __verificationAttachesToBundle = Assert<VerifiedBundle extends ExtractionBundle ? true : false>;

export {};
