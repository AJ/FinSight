import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Category } from "@/types";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/categories";

interface CategoryStore {
  categories: Category[];
  addCategory: (category: Category) => void;
  updateCategory: (id: string, updates: Partial<Category>) => void;
  deleteCategory: (id: string) => void;
  getCategoryById: (id: string) => Category | undefined;
  initializeDefaultCategories: () => void;
}

export const useCategoryStore = create<CategoryStore>()(
  persist(
    (set, get) => ({
      categories: [],

      addCategory: (category) =>
        set((state) => ({
          categories: [...state.categories, category],
        })),

      updateCategory: (id, updates) =>
        set((state) => ({
          categories: state.categories.map((cat) => {
            if (cat.id !== id) return cat;
            // Create new Category instance with updates
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { Category } = require('@/types');
            return new Category(
              updates.id ?? cat.id,
              updates.name ?? cat.name,
              updates.type ?? cat.type,
              updates.color ?? cat.color,
              updates.icon ?? cat.icon,
              updates.keywords ?? cat.keywords,
            );
          }),
        })),

      deleteCategory: (id) =>
        set((state) => ({
          categories: state.categories.filter((cat) => cat.id !== id),
        })),

      getCategoryById: (id) => {
        return get().categories.find((cat) => cat.id === id);
      },

      initializeDefaultCategories: () => {
        const { categories } = get();
        // Check if we have the new category format (groceries, dining, etc.)
        const hasNewFormat = categories.some((c) => c.id === "groceries");
        if (categories.length === 0 || !hasNewFormat) {
          set({ categories: DEFAULT_CATEGORIES });
        }
      },
    }),
    {
      name: "category-storage",
      version: 2, // Bump version to trigger migration to new categories
      migrate: (persisted, version) => {
        // Force reset to new categories on migration
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          return { categories: DEFAULT_CATEGORIES } as unknown as CategoryStore;
        }
        return state as unknown as CategoryStore;
      },
    },
  ),
);
