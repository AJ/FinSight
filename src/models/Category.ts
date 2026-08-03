export type CategoryGroup = 'needs' | 'wants' | 'saves';

/**
 * Category class with static registry for lookup.
 * Categories are registered at module load time via Category.register().
 *
 * A category carries two category-level facts:
 *  - `budgetable` — whether a user can allocate a budget line to it. A direct
 *    per-category attribute, decided at registration from real-world reasoning
 *    (you budget for planned spending and planned investments; not for income,
 *    transfers, debt payments, refunds, interest, adjustments, taxes, or fees).
 *  - spending/income kind — NOT stored here. Derived from the subtype→category
 *    map (`src/lib/classification/subtypeCategories.ts`): a category is
 *    spending-kind if it sits under a spending subtype, income-kind otherwise.
 *
 * `CategoryType` is gone. A transaction's role is never read off the category;
 * it comes from the transaction's subtype. See spec §3.2.
 */
export class Category {
  /** Default category ID for uncategorized transactions */
  static readonly DEFAULT_ID = "other";

  private static registry = new Map<string, Category>();

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly budgetable: boolean,
    public readonly keywords: string[] = [],
    public readonly icon?: string,
    public readonly color?: string,
    public readonly group?: CategoryGroup,
    public readonly guidance?: string,
  ) {}

  static register(category: Category): void {
    Category.registry.set(category.id, category);
  }

  static fromId(id: string): Category | undefined {
    return Category.registry.get(id);
  }

  static getAll(): Category[] {
    return Array.from(Category.registry.values());
  }

  static getByGroup(group: CategoryGroup): Category[] {
    return Category.getAll().filter((c) => c.group === group);
  }
}
