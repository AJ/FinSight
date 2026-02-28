import { Category, CategoryType } from "@/models";

// Register all categories at module load time
Category.register(new Category("groceries", "Groceries", CategoryType.Expense,
  ["supermarket", "grocery", "groceries", "walmart", "kroger",
    "whole foods", "costco", "aldi", "safeway", "publix",
    "trader joe", "target", "market", "food", "h-e-b", "meijer",
    "sams club", "bj", "fresh", "produce"],
  "ShoppingCart", "#22c55e"));

Category.register(new Category("dining", "Dining", CategoryType.Expense,
  ["restaurant", "cafe", "coffee", "starbucks", "mcdonalds",
    "burger", "pizza", "sushi", "diner", "bistro", "grill",
    "dunkin", "tim hortons", "chipotle", "subway", "domino",
    "papa john", "kfc", "taco bell", "wendys", "doordash",
    "uber eats", "grubhub", "postmates", "eatery", "brasserie",
    "swiggy", "zomato", "blinkit", "zepto", "instamart", "foodpanda",
    "deliveroo", "menulog", "just eat", "skipthedishes"],
  "Utensils", "#f97316"));

Category.register(new Category("transportation", "Transportation", CategoryType.Expense,
  ["gas", "fuel", "shell", "exxon", "chevron", "bp", "mobil",
    "uber", "lyft", "taxi", "parking", "toll", "car wash",
    "auto", "mechanic", "oil change", "tire", "repair",
    "bus", "metro", "transit", "train", "amtrak", "fuel station"],
  "Car", "#3b82f6"));

Category.register(new Category("utilities", "Utilities", CategoryType.Expense,
  ["electric", "electricity", "power", "water", "gas bill",
    "internet", "phone", "mobile", "verizon", "at&t", "t-mobile",
    "comcast", "xfinity", "spectrum", "utility", "sewer",
    "garbage", "trash", "heating", "cooling", "pge", "duke energy"],
  "Zap", "#eab308"));

Category.register(new Category("housing", "Housing", CategoryType.Expense,
  ["rent", "mortgage", "home", "apartment", "lease",
    "maintenance", "repair", "property", "hoa", "condo",
    "landlord", "real estate", "housing"],
  "Home", "#8b5cf6"));

Category.register(new Category("healthcare", "Healthcare", CategoryType.Expense,
  ["pharmacy", "doctor", "hospital", "medical", "health",
    "dental", "vision", "optometry", "clinic", "urgent care",
    "cvs", "walgreens", "rite aid", "prescription", "medicine",
    "insurance", "copay", "deductible", "lab", "specialist"],
  "Heart", "#ef4444"));

Category.register(new Category("entertainment", "Entertainment", CategoryType.Expense,
  ["netflix", "spotify", "hulu", "disney", "hbo", "amazon prime",
    "youtube", "movie", "cinema", "theater", "concert", "gaming",
    "playstation", "xbox", "nintendo", "steam", "game", "music",
    "apple music", "tidal", "deezer", "audible", "podcast"],
  "Film", "#ec4899"));

Category.register(new Category("shopping", "Shopping", CategoryType.Expense,
  ["amazon", "ebay", "etsy", "wish", "aliexpress",
    "best buy", "apple store", "google store", "microsoft store",
    "nordstrom", "macy", "jcpenney", "kohl", "ross", "tj maxx",
    "marshalls", "home depot", "lowes", "ikea", "wayfair",
    "retail", "store", "shop", "online", "order"],
  "ShoppingBag", "#14b8a6"));

Category.register(new Category("income", "Income", CategoryType.Income,
  ["salary", "paycheck", "deposit", "income", "payment received",
    "wage", "earnings", "credited", "refund",
    "cashback", "dividend", "bonus", "stipend",
    "freelance", "invoice paid", "direct deposit", "payroll"],
  "TrendingUp", "#10b981"));

Category.register(new Category("interest", "Interest", CategoryType.Income,
  ["interest", "interest credit", "interest paid", "int credit",
    "int. paid", "interest earned", "savings interest",
    "interest income", "int cr", "interest cr"],
  "Percent", "#84cc16"));

Category.register(new Category("cashback", "Cashback", CategoryType.Income,
  ["cashback", "cash back", "cash_back", "cb", "reward",
    "rewards", "cashback credit", "cashback received",
    "global_value_cash", "gv cash", "cashback adjustment",
    "reward credit", "loyalty cashback", "points redemption",
    "cash reward", "moneyback", "rebate", "gift card",
    "giftcard", "gift-card", "gv", "gift voucher"],
  "Percent", "#22c55e"));

Category.register(new Category("transfer", "Transfer", CategoryType.Excluded,
  ["transfer", "zelle", "venmo", "paypal", "cash app",
    "wire", "ach", "sent to", "received from", "p2p",
    "peer to peer", "payment sent", "payment received",
    "fund transfer", "money transfer", "neft", "rtgs", "imps"],
  "ArrowLeftRight", "#6366f1"));

Category.register(new Category("bills", "Bills & Payments", CategoryType.Expense,
  ["bill payment", "bill pay", "cc payment", "credit card payment",
    "card payment", "loan payment", "emi", "loan emi",
    "credit card bill", "card bill", "loan repayment",
    "payment to", "pmt", "payment-debit", "autopay"],
  "Receipt", "#f59e0b"));

Category.register(new Category("investment", "Investment", CategoryType.Excluded,
  ["stock", "stocks", "dividend", "crypto", "bitcoin", "ethereum",
    "trading", "investment", "brokerage", "fidelity", "vanguard",
    "schwab", "robinhood", "coinbase", "binance", "etf", "mutual fund",
    "401k", "ira", "securities"],
  "LineChart", "#0891b2"));

Category.register(new Category("insurance", "Insurance", CategoryType.Expense,
  ["insurance", "premium", "coverage", "policy", "geico",
    "progressive", "state farm", "allstate", "farmers",
    "life insurance", "auto insurance", "home insurance",
    "health insurance", "liability"],
  "Shield", "#64748b"));

Category.register(new Category("education", "Education", CategoryType.Expense,
  ["tuition", "school", "university", "college", "course",
    "books", "textbook", "education", "learning", "udemy",
    "coursera", "edx", "skillshare", "masterclass", "training",
    "workshop", "seminar", "class", "lesson", "tutoring"],
  "GraduationCap", "#7c3aed"));

Category.register(new Category("travel", "Travel", CategoryType.Expense,
  ["airline", "flight", "hotel", "booking", "airbnb",
    "expedia", "booking.com", "travel", "vacation", "trip",
    "united", "delta", "american airlines", "southwest",
    "jetblue", "marriott", "hilton", "hyatt", "rental car",
    "hertz", "enterprise", "avis", "lyft", "uber"],
  "Plane", "#0ea5e9"));

Category.register(new Category("other", "Other", CategoryType.Excluded,
  [],
  "HelpCircle", "#6b7280"));

/**
 * Default categories for transaction classification.
 * Each category has keywords for fallback matching when LLM is unavailable.
 */
export const DEFAULT_CATEGORIES: Category[] = Category.getAll();

/**
 * Get a category by its ID.
 */
export function getCategoryById(id: string): Category | undefined {
  return Category.fromId(id);
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
export function getCategoriesByType(type: CategoryType): Category[] {
  return Category.getByType(type);
}
