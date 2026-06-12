import { CategoryType } from './CategoryType';

export type CategoryGroup = 'needs' | 'wants' | 'saves';

/**
 * Category class with static registry for lookup.
 * Categories are registered at module load time via Category.register().
 */
export class Category {
  /** Default category ID for uncategorized transactions */
  static readonly DEFAULT_ID = "other";

  private static registry = new Map<string, Category>();

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: CategoryType,
    public readonly keywords: string[] = [],
    public readonly icon?: string,
    public readonly color?: string,
    public readonly group?: CategoryGroup,
    public readonly guidance?: string,
  ) {}

  get isIncome(): boolean {
    return this.type === CategoryType.Income;
  }
  get isExpense(): boolean {
    return this.type === CategoryType.Expense;
  }
  get isExcluded(): boolean {
    return this.type === CategoryType.Excluded;
  }
  get isDebtPayment(): boolean {
    return this.type === CategoryType.DebtPayment;
  }
  get isInvestment(): boolean {
    return this.type === CategoryType.Investment;
  }

  static register(category: Category): void {
    Category.registry.set(category.id, category);
  }

  static fromId(id: string): Category | undefined {
    return Category.registry.get(id);
  }

  static getAll(): Category[] {
    return Array.from(Category.registry.values());
  }

  static getByType(type: CategoryType): Category[] {
    return Category.getAll().filter((c) => c.type === type);
  }

  static getByGroup(group: CategoryGroup): Category[] {
    return Category.getAll().filter((c) => c.group === group);
  }
}
