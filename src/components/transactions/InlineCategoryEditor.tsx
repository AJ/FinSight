"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getCategoryById, DEFAULT_CATEGORIES } from "@/lib/categorization/categories";
import { getCategoryDisplay } from "./CategoryBadge";
import { ChevronDown, AlertCircle, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryType } from "@/types";

interface InlineCategoryEditorProps {
  categoryId: string;
  isIncome: boolean;
  needsReview?: boolean;
  onCategoryChange: (newCategory: string) => void;
  className?: string;
}

export function InlineCategoryEditor({
  categoryId,
  isIncome,
  needsReview = false,
  onCategoryChange,
  className,
}: InlineCategoryEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const category = getCategoryById(categoryId);
  const display = getCategoryDisplay(categoryId);
  const IconComponent = display.icon;

  // Filter categories by category type and search term
  const filteredCategories = useMemo(() => {
    const targetCategoryType = isIncome ? CategoryType.Income : CategoryType.Expense;
    return DEFAULT_CATEGORIES.filter((c) => {
      // Show categories matching the target type (exclude "excluded" categories)
      const matchesType = c.type === targetCategoryType;
      if (!matchesType) return false;

      if (!searchTerm) return true;

      const search = searchTerm.toLowerCase();
      const matchesName = c.name.toLowerCase().includes(search);
      const matchesKeywords = c.keywords.some(kw => kw.toLowerCase().includes(search));
      return matchesName || matchesKeywords;
    });
  }, [isIncome, searchTerm]);

  // Reset search when popover closes
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchTerm("");
    }
  };

  if (!category) {
    return (
      <Badge variant="outline" className={cn("gap-1 font-normal", className)}>
        ?
      </Badge>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
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
        {/* Search input */}
        <div className="relative mb-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 pl-7 text-sm"
            autoFocus
          />
        </div>

        <div className="max-h-56 overflow-y-auto">
          {filteredCategories.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-3">
              No categories found
            </div>
          ) : (
            filteredCategories.map((cat) => {
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
            })
          )}
        </div>
      </PopoverContent>

      {needsReview && (
        <span className="flex items-center gap-1 text-xs text-amber-600 ml-2">
          <AlertCircle className="w-3 h-3" />
          <span className="hidden sm:inline">Review</span>
        </span>
      )}
    </Popover>
  );
}
