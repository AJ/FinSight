"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getCategoryById, DEFAULT_CATEGORIES } from "@/lib/categorization/categories";
import { getCategoryDisplay } from "./CategoryBadge";
import { ChevronDown, AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface InlineCategoryEditorProps {
  categoryId: string;
  transactionType: "income" | "expense" | "transfer";
  needsReview?: boolean;
  onCategoryChange: (newCategory: string) => void;
  className?: string;
}

export function InlineCategoryEditor({
  categoryId,
  transactionType,
  needsReview = false,
  onCategoryChange,
  className,
}: InlineCategoryEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const category = getCategoryById(categoryId);
  const display = getCategoryDisplay(categoryId);
  const IconComponent = display.icon;

  if (!category) {
    return (
      <Badge variant="outline" className={cn("gap-1 font-normal", className)}>
        ?
      </Badge>
    );
  }

  const filteredCategories = DEFAULT_CATEGORIES.filter(
    (c) => c.type === transactionType || c.type === "both"
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "group flex items-center justify-between gap-2 px-3 py-1.5 rounded-md transition-all duration-200 w-full",
            "border border-border/70 bg-background hover:border-primary/40 hover:bg-muted/30",
            "focus:outline-none focus:ring-2 focus:ring-primary/30",
            needsReview && "border-amber-400/50 bg-amber-500/5",
            className
          )}
        >
          <span
            className="flex items-center gap-2 text-sm font-medium"
            style={{ color: display.color }}
          >
            <IconComponent className="w-4 h-4" />
            <span>{display.name}</span>
          </span>
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-180"
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-64 p-1.5"
        align="start"
        sideOffset={4}
      >
        <div className="text-xs text-muted-foreground px-2 py-1.5 border-b border-border mb-1">
          Change category
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filteredCategories.map((cat) => {
            const catDisplay = getCategoryDisplay(cat.id);
            const CatIcon = catDisplay.icon;
            const isSelected = cat.id === categoryId;

            return (
              <button
                key={cat.id}
                onClick={() => {
                  onCategoryChange(cat.id);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                  "hover:bg-muted",
                  isSelected && "bg-muted/50"
                )}
              >
                <CatIcon
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: catDisplay.color }}
                />
                <span className="flex-1 text-left">{cat.name}</span>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-primary" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>

      {needsReview && (
        <span className="flex items-center gap-1 text-xs text-amber-600 ml-2">
          <AlertCircle className="w-3 h-3" />
          <span className="hidden sm:inline">review</span>
        </span>
      )}
    </Popover>
  );
}
