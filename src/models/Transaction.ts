import { TransactionType } from './TransactionType';
import { Category } from './Category';
import { CategorizedBy } from './CategorizedBy';
import { SourceType } from './SourceType';
import { AnomalyType } from './AnomalyType';
import { AnomalyDetails } from './AnomalyDetails';

/**
 * JSON representation of a Transaction for serialization.
 * Category is stored as ID string; use Transaction.fromJSON() to restore.
 */
export interface TransactionJSON {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  category: string; // Category ID (look up via Category.fromId() to get Category object)
  balance?: number;
  merchant?: string;
  originalText?: string;
  budgetMonth?: string;
  categoryConfidence?: number;
  needsReview?: boolean;
  categorizedBy?: CategorizedBy;
  sourceType?: SourceType;
  statementId?: string;
  cardIssuer?: string;
  cardLastFour?: string;
  cardHolder?: string;
  currency?: string;
  originalAmount?: number;
  isAnomaly?: boolean;
  anomalyTypes?: AnomalyType[];
  anomalyDetails?: AnomalyDetails;
  anomalyDismissed?: boolean;
}

/**
 * Transaction class representing a financial transaction.
 * Use Transaction.fromJSON() to deserialize from storage.
 */
export class Transaction {
  constructor(
    public readonly id: string,
    public readonly date: Date,
    public readonly description: string,
    public readonly amount: number,
    public readonly type: TransactionType,
    public category: Category,
    public readonly balance?: number,
    public readonly merchant?: string,
    public readonly originalText?: string,
    public readonly budgetMonth?: string,
    public categoryConfidence?: number,
    public needsReview?: boolean,
    public categorizedBy?: CategorizedBy,
    public readonly sourceType?: SourceType,
    public readonly statementId?: string,
    public readonly cardIssuer?: string,
    public readonly cardLastFour?: string,
    public readonly cardHolder?: string,
    public readonly currency?: string,
    public readonly originalAmount?: number,
    public isAnomaly?: boolean,
    public anomalyTypes?: AnomalyType[],
    public anomalyDetails?: AnomalyDetails,
    public anomalyDismissed?: boolean,
  ) {}

  // Direction getters (from TransactionType)
  get isCredit(): boolean {
    return this.type === TransactionType.Credit;
  }
  get isDebit(): boolean {
    return this.type === TransactionType.Debit;
  }

  // Economic type getters (from Category)
  get isIncome(): boolean {
    return this.category.isIncome;
  }
  get isExpense(): boolean {
    return this.category.isExpense;
  }
  get isExcluded(): boolean {
    return this.category.isExcluded;
  }

  // Signed amount for calculations (negative for debits)
  get signedAmount(): number {
    return this.isDebit ? -this.amount : this.amount;
  }

  toJSON(): TransactionJSON {
    return {
      id: this.id,
      date: this.date.toISOString(),
      description: this.description,
      amount: this.amount,
      type: this.type,
      category: this.category.id,
      balance: this.balance,
      merchant: this.merchant,
      originalText: this.originalText,
      budgetMonth: this.budgetMonth,
      categoryConfidence: this.categoryConfidence,
      needsReview: this.needsReview,
      categorizedBy: this.categorizedBy,
      sourceType: this.sourceType,
      statementId: this.statementId,
      cardIssuer: this.cardIssuer,
      cardLastFour: this.cardLastFour,
      cardHolder: this.cardHolder,
      currency: this.currency,
      originalAmount: this.originalAmount,
      isAnomaly: this.isAnomaly,
      anomalyTypes: this.anomalyTypes,
      anomalyDetails: this.anomalyDetails,
      anomalyDismissed: this.anomalyDismissed,
    };
  }

  static fromJSON(json: TransactionJSON): Transaction {
    const category =
      Category.fromId(json.category) ?? Category.fromId(Category.DEFAULT_ID)!;

    return new Transaction(
      json.id,
      new Date(json.date),
      json.description,
      Math.abs(json.amount),
      json.type,
      category,
      json.balance,
      json.merchant,
      json.originalText,
      json.budgetMonth,
      json.categoryConfidence,
      json.needsReview,
      json.categorizedBy,
      json.sourceType,
      json.statementId,
      json.cardIssuer,
      json.cardLastFour,
      json.cardHolder,
      json.currency,
      json.originalAmount,
      json.isAnomaly,
      json.anomalyTypes,
      json.anomalyDetails,
      json.anomalyDismissed,
    );
  }
}
