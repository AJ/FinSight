import { Category } from "@/types";

/**
 * Default categories for transaction classification.
 * Each category has keywords for fallback matching when LLM is unavailable.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: "groceries",
    name: "Groceries",
    icon: "ShoppingCart",
    color: "#22c55e",
    type: "expense",
    keywords: [
      "supermarket", "grocery", "groceries", "walmart", "kroger",
      "whole foods", "costco", "aldi", "safeway", "publix",
      "trader joe", "target", "market", "food", "h-e-b", "meijer",
      "sams club", "bj", "fresh", "produce"
    ],
  },
  {
    id: "dining",
    name: "Dining",
    icon: "Utensils",
    color: "#f97316",
    type: "expense",
    keywords: [
      "restaurant", "cafe", "coffee", "starbucks", "mcdonalds",
      "burger", "pizza", "sushi", "diner", "bistro", "grill",
      "dunkin", "tim hortons", "chipotle", "subway", "domino",
      "papa john", "kfc", "taco bell", "wendys", "doordash",
      "uber eats", "grubhub", "postmates", "eatery", "brasserie"
    ],
  },
  {
    id: "transportation",
    name: "Transportation",
    icon: "Car",
    color: "#3b82f6",
    type: "expense",
    keywords: [
      "gas", "fuel", "shell", "exxon", "chevron", "bp", "mobil",
      "uber", "lyft", "taxi", "parking", "toll", "car wash",
      "auto", "mechanic", "oil change", "tire", "repair",
      "bus", "metro", "transit", "train", "amtrak", "fuel station"
    ],
  },
  {
    id: "utilities",
    name: "Utilities",
    icon: "Zap",
    color: "#eab308",
    type: "expense",
    keywords: [
      "electric", "electricity", "power", "water", "gas bill",
      "internet", "phone", "mobile", "verizon", "at&t", "t-mobile",
      "comcast", "xfinity", "spectrum", "utility", "sewer",
      "garbage", "trash", "heating", "cooling", "pge", "duke energy"
    ],
  },
  {
    id: "housing",
    name: "Housing",
    icon: "Home",
    color: "#8b5cf6",
    type: "expense",
    keywords: [
      "rent", "mortgage", "home", "apartment", "lease",
      "maintenance", "repair", "property", "hoa", "condo",
      "landlord", "real estate", "housing"
    ],
  },
  {
    id: "healthcare",
    name: "Healthcare",
    icon: "Heart",
    color: "#ef4444",
    type: "expense",
    keywords: [
      "pharmacy", "doctor", "hospital", "medical", "health",
      "dental", "vision", "optometry", "clinic", "urgent care",
      "cvs", "walgreens", "rite aid", "prescription", "medicine",
      "insurance", "copay", "deductible", "lab", "specialist"
    ],
  },
  {
    id: "entertainment",
    name: "Entertainment",
    icon: "Film",
    color: "#ec4899",
    type: "expense",
    keywords: [
      "netflix", "spotify", "hulu", "disney", "hbo", "amazon prime",
      "youtube", "movie", "cinema", "theater", "concert", "gaming",
      "playstation", "xbox", "nintendo", "steam", "game", "music",
      "apple music", "tidal", "deezer", "audible", "podcast"
    ],
  },
  {
    id: "shopping",
    name: "Shopping",
    icon: "ShoppingBag",
    color: "#14b8a6",
    type: "expense",
    keywords: [
      "amazon", "ebay", "etsy", "wish", "aliexpress",
      "best buy", "apple store", "google store", "microsoft store",
      "nordstrom", "macy", "jcpenney", "kohl", "ross", "tj maxx",
      "marshalls", "home depot", "lowes", "ikea", "wayfair",
      "retail", "store", "shop", "online", "order"
    ],
  },
  {
    id: "income",
    name: "Income",
    icon: "TrendingUp",
    color: "#10b981",
    type: "income",
    keywords: [
      "salary", "paycheck", "deposit", "income", "payment received",
      "wage", "earnings", "credited", "refund",
      "cashback", "dividend", "bonus", "stipend",
      "freelance", "invoice paid", "direct deposit", "payroll"
    ],
  },
  {
    id: "interest",
    name: "Interest",
    icon: "Percent",
    color: "#84cc16",
    type: "income",
    keywords: [
      "interest", "interest credit", "interest paid", "int credit",
      "int. paid", "interest earned", "savings interest",
      "interest income", "int cr", "interest cr"
    ],
  },
  {
    id: "transfer",
    name: "Transfer",
    icon: "ArrowLeftRight",
    color: "#6366f1",
    type: "both",
    keywords: [
      "transfer", "zelle", "venmo", "paypal", "cash app",
      "wire", "ach", "sent to", "received from", "p2p",
      "peer to peer", "payment sent", "payment received",
      "fund transfer", "money transfer", "neft", "rtgs", "imps"
    ],
  },
  {
    id: "bills",
    name: "Bills & Payments",
    icon: "Receipt",
    color: "#f59e0b",
    type: "expense",
    keywords: [
      "bill payment", "bill pay", "cc payment", "credit card payment",
      "card payment", "loan payment", "emi", "loan emi",
      "credit card bill", "card bill", "loan repayment",
      "payment to", "pmt", "payment-debit", "autopay"
    ],
  },
  {
    id: "investment",
    name: "Investment",
    icon: "LineChart",
    color: "#0891b2",
    type: "both",
    keywords: [
      "stock", "stocks", "dividend", "crypto", "bitcoin", "ethereum",
      "trading", "investment", "brokerage", "fidelity", "vanguard",
      "schwab", "robinhood", "coinbase", "binance", "etf", "mutual fund",
      "401k", "ira", "securities"
    ],
  },
  {
    id: "insurance",
    name: "Insurance",
    icon: "Shield",
    color: "#64748b",
    type: "expense",
    keywords: [
      "insurance", "premium", "coverage", "policy", "geico",
      "progressive", "state farm", "allstate", "farmers",
      "life insurance", "auto insurance", "home insurance",
      "health insurance", "liability"
    ],
  },
  {
    id: "education",
    name: "Education",
    icon: "GraduationCap",
    color: "#7c3aed",
    type: "expense",
    keywords: [
      "tuition", "school", "university", "college", "course",
      "books", "textbook", "education", "learning", "udemy",
      "coursera", "edx", "skillshare", "masterclass", "training",
      "workshop", "seminar", "class", "lesson", "tutoring"
    ],
  },
  {
    id: "travel",
    name: "Travel",
    icon: "Plane",
    color: "#0ea5e9",
    type: "expense",
    keywords: [
      "airline", "flight", "hotel", "booking", "airbnb",
      "expedia", "booking.com", "travel", "vacation", "trip",
      "united", "delta", "american airlines", "southwest",
      "jetblue", "marriott", "hilton", "hyatt", "rental car",
      "hertz", "enterprise", "avis", "lyft", "uber"
    ],
  },
  {
    id: "other",
    name: "Other",
    icon: "HelpCircle",
    color: "#6b7280",
    type: "both",
    keywords: [],
  },
];

/**
 * Get a category by its ID.
 */
export function getCategoryById(id: string): Category | undefined {
  return DEFAULT_CATEGORIES.find((c) => c.id === id);
}

/**
 * Get all category IDs.
 */
export function getCategoryIds(): string[] {
  return DEFAULT_CATEGORIES.map((c) => c.id);
}

/**
 * Get categories filtered by type.
 */
export function getCategoriesByType(
  type: "income" | "expense" | "both"
): Category[] {
  if (type === "both") {
    return DEFAULT_CATEGORIES.filter((c) => c.type === "both");
  }
  return DEFAULT_CATEGORIES.filter(
    (c) => c.type === type || c.type === "both"
  );
}
