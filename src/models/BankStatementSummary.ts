export interface BankStatementSummary {
  id: string;
  accountNumber: string | null;
  bankName: string | null;
  statementDate: string;
  openingBalance: number;
  closingBalance: number;
  statementPeriodStart: string;
  statementPeriodEnd: string;
  sourceFileHash?: string;
}
