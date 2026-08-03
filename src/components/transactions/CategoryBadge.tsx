"use client";

import { Badge } from "@/components/ui/badge";
import { getCategoryById } from "@/lib/categorization/categories";
import { HelpCircle } from "lucide-react";
import { iconMap } from "./categoryDisplay";

interface CategoryBadgeProps {
  categoryId: string;
  className?: string;
}

export function CategoryBadge({
  categoryId,
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
    </div>
  );
}

export { getCategoryIcon, getCategoryDisplay } from "./categoryDisplay";
