import { getCategoryById } from "@/lib/categorization/categories";
import { Category } from "@/models/Category";
import {
  ShoppingCart,
  Utensils,
  Car,
  Zap,
  Home,
  Heart,
  Film,
  ShoppingBag,
  TrendingUp,
  ArrowLeftRight,
  LineChart,
  Shield,
  GraduationCap,
  Plane,
  HelpCircle,
  Percent,
  Receipt,
  type LucideIcon,
} from "lucide-react";

export const iconMap: Record<string, LucideIcon> = {
  ShoppingCart,
  Utensils,
  Car,
  Zap,
  Home,
  Heart,
  Film,
  ShoppingBag,
  TrendingUp,
  ArrowLeftRight,
  LineChart,
  Shield,
  GraduationCap,
  Plane,
  HelpCircle,
  Percent,
  Receipt,
};

export function getCategoryIcon(categoryId: string): LucideIcon {
  const category = getCategoryById(categoryId);
  if (!category || !category.icon) return HelpCircle;
  return iconMap[category.icon] || HelpCircle;
}

export function getCategoryDisplay(categoryId: string): {
  name: string;
  icon: LucideIcon;
  color: string;
} {
  const category = getCategoryById(categoryId);
  const iconName = category?.icon || "";
  return {
    name: category?.name || "Unknown",
    icon: iconMap[iconName] || HelpCircle,
    color: category?.color || "#6b7280",
  };
}

export function categoryMatchesSearch(
  category: Pick<Category, "name" | "keywords">,
  searchTerm: string,
): boolean {
  if (!searchTerm) return true;
  const search = searchTerm.toLowerCase();
  const matchesName = category.name.toLowerCase().includes(search);
  const matchesKeywords = category.keywords.some((kw) =>
    kw.toLowerCase().includes(search),
  );
  return matchesName || matchesKeywords;
}

export function filterAndSortCategories(
  categories: Pick<Category, "id" | "name" | "keywords">[],
  searchTerm: string,
): Pick<Category, "id" | "name" | "keywords">[] {
  const filtered = categories.filter((c) =>
    categoryMatchesSearch(c, searchTerm),
  );

  const otherCategory = filtered.find((c) => c.id === "other");
  const regularCategories = filtered
    .filter((c) => c.id !== "other")
    .sort((a, b) => a.name.localeCompare(b.name));

  return otherCategory
    ? [...regularCategories, otherCategory]
    : regularCategories;
}
