"use client";

import { Badge } from "@/components/ui/badge";
import { getCategoryById } from "@/lib/categorization/categories";
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
  AlertCircle,
  Percent,
  Receipt,
  LucideIcon,
} from "lucide-react";

// Map icon names to Lucide components
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

interface CategoryBadgeProps {
  categoryId: string;
  showReviewBadge?: boolean;
  needsReview?: boolean;
  confidence?: number;
  className?: string;
}

export function CategoryBadge({
  categoryId,
  showReviewBadge = false,
  needsReview = false,
  confidence,
  className = "",
}: CategoryBadgeProps) {
  const category = getCategoryById(categoryId);

  if (!category) {
    return (
      <Badge variant="outline" className={className}>
        <HelpCircle className="w-3 h-3 mr-1" />
        Unknown
      </Badge>
    );
  }

  const IconComponent = iconMap[category.icon || ""] || HelpCircle;

  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant="secondary"
        className={`${className} gap-1 font-normal`}
        style={{
          backgroundColor: `${category.color}15`,
          color: category.color,
          borderColor: `${category.color}30`,
        }}
      >
        <IconComponent className="w-3 h-3" />
        {category.name}
      </Badge>

      {showReviewBadge && needsReview && (
        <Badge
          variant="outline"
          className="gap-1 font-normal text-amber-600 border-amber-300 bg-amber-50"
        >
          <AlertCircle className="w-3 h-3" />
          Review
        </Badge>
      )}

      {confidence !== undefined && confidence < 0.6 && (
        <Badge
          variant="outline"
          className="gap-1 font-normal text-red-600 border-red-300 bg-red-50"
        >
          Low Confidence
        </Badge>
      )}
    </div>
  );
}

/**
 * Get just the icon component for a category.
 */
export function getCategoryIcon(categoryId: string): LucideIcon {
  const category = getCategoryById(categoryId);
  if (!category || !category.icon) return HelpCircle;
  return iconMap[category.icon] || HelpCircle;
}

/**
 * Get category display info.
 */
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
