import { Category } from "@/models/Category";

// Register all categories at module load time.
// Constructor: (id, name, budgetable, keywords, icon, color, group, guidance).
// `budgetable` is a direct per-category attribute (spec §3.2): you budget for
// planned spending and planned investments; not for income, transfers, debt
// payments, refunds, interest, adjustments, taxes, or fees.
//
// Registration order is the order categories appear in the categorization LLM's
// category list (DEFAULT_CATEGORIES below feeds the prompt). Small models lean
// toward early-listed categories on rows with no strong signal, so a broad,
// generic bucket (shopping) is registered first to give those rows a sane
// default instead of a specific one like dining. UI dropdowns do not depend on
// this order — they sort alphabetically (see ReviewEditDialog, InlineCategoryEditor,
// and the transactions-page filter).

Category.register(new Category("shopping", "Shopping", true,
  ["amazon", "ebay", "etsy", "wish", "aliexpress",
    "best buy", "apple store", "google store", "microsoft store",
    "nordstrom", "macy", "jcpenney", "kohl", "ross", "tj maxx",
    "marshalls", "home depot", "lowes", "ikea", "wayfair",
    "retail", "store", "shop", "online", "order"],
  "ShoppingBag", "#14b8a6", "wants",
  "Retail, e-commerce, electronics, apparel, home goods, and general shopping."));

Category.register(new Category("groceries", "Groceries", true,
  ["supermarket", "grocery", "groceries", "walmart", "kroger",
    "whole foods", "costco", "aldi", "safeway", "publix",
    "trader joe", "target", "market", "food", "h-e-b", "meijer",
    "sams club", "bj", "fresh", "produce"],
  "ShoppingCart", "#22c55e", "needs",
  "Supermarkets, grocery stores, fresh produce, food staples, and routine household essentials."));

Category.register(new Category("dining", "Dining", true,
  ["restaurant", "cafe", "coffee", "starbucks", "mcdonalds",
    "burger", "pizza", "sushi", "diner", "bistro", "grill",
    "dunkin", "tim hortons", "chipotle", "subway", "domino",
    "papa john", "kfc", "taco bell", "wendys", "doordash",
    "uber eats", "grubhub", "postmates", "eatery", "brasserie",
    "swiggy", "zomato", "blinkit", "zepto", "instamart", "foodpanda",
    "deliveroo", "menulog", "just eat", "skipthedishes"],
  "Utensils", "#f97316", "wants",
  "Restaurants, cafes, coffee shops, bars, takeout, and food delivery."));

Category.register(new Category("transportation", "Transportation", true,
  ["gas", "fuel", "shell", "exxon", "chevron", "bp", "mobil",
    "uber", "lyft", "taxi", "parking", "toll", "car wash",
    "auto", "mechanic", "oil change", "tire", "repair",
    "bus", "metro", "transit", "train", "amtrak", "fuel station"],
  "Car", "#3b82f6", "needs",
  "Fuel, public transit, ride-hailing, taxi, parking, tolls, and vehicle upkeep."));

Category.register(new Category("utilities", "Utilities", true,
  ["electric", "electricity", "power", "water", "gas bill",
    "internet", "phone", "mobile", "verizon", "at&t", "t-mobile",
    "comcast", "xfinity", "spectrum", "utility", "sewer",
    "garbage", "trash", "heating", "cooling", "pge", "duke energy"],
  "Zap", "#eab308", "needs",
  "Electricity, water, gas, internet, mobile, phone, and other utility bills."));

Category.register(new Category("housing", "Housing", true,
  ["rent", "mortgage", "home", "apartment", "lease",
    "maintenance", "repair", "property", "hoa", "condo",
    "landlord", "real estate", "housing"],
  "Home", "#8b5cf6", "needs",
  "Rent, mortgage, housing maintenance, HOA, and property-related costs."));

Category.register(new Category("healthcare", "Healthcare", true,
  ["pharmacy", "doctor", "hospital", "medical", "health",
    "dental", "vision", "optometry", "clinic", "urgent care",
    "cvs", "walgreens", "rite aid", "prescription", "medicine",
    "insurance", "copay", "deductible", "lab", "specialist"],
  "Heart", "#ef4444", "needs",
  "Pharmacy, doctor, clinic, hospital, medical treatment, and health-related spending."));

Category.register(new Category("entertainment", "Entertainment", true,
  ["netflix", "spotify", "hulu", "disney", "hbo", "amazon prime",
    "youtube", "movie", "cinema", "theater", "concert", "gaming",
    "playstation", "xbox", "nintendo", "steam", "game", "music",
    "apple music", "tidal", "deezer", "audible", "podcast"],
  "Film", "#ec4899", "wants",
  "Streaming, movies, games, concerts, subscriptions, and leisure spending."));

Category.register(new Category("income", "Income", false,
  ["salary", "paycheck", "deposit", "income", "payment received",
    "wage", "earnings", "credited", "refund",
    "cashback", "dividend", "bonus", "stipend",
    "freelance", "invoice paid", "direct deposit", "payroll"],
  "TrendingUp", "#10b981", undefined,
  "Salary, payroll, freelance income, reimbursements treated as income, and money earned from work."));

Category.register(new Category("interest", "Interest", false,
  ["interest", "interest credit", "interest paid", "int credit",
    "int. paid", "interest earned", "savings interest",
    "interest income", "int cr", "interest cr",
    "finance charge", "interest charged", "interest debited",
    "igp", "interest payment", "loan interest", "credit interest",
    "overdue interest", "penal interest", "interest on"],
  "Percent", "#84cc16", undefined,
  "Interest credited or charged by a bank or financial institution. Role follows direction (earned vs charged)."));

Category.register(new Category("cashback", "Cashback", false,
  ["cashback", "cash back", "cash_back", "cb", "reward",
    "rewards", "cashback credit", "cashback received",
    "global_value_cash", "gv cash", "cashback adjustment",
    "reward credit", "loyalty cashback", "points redemption",
    "cash reward", "moneyback", "rebate", "gift card",
    "giftcard", "gift-card", "gv", "gift voucher"],
  "Percent", "#fbbf24", undefined,
  "Cashback, reward credits, rebates, gift voucher credits, and similar incentive credits."));

Category.register(new Category("transfer", "Transfer", false,
  ["transfer", "zelle", "venmo", "paypal", "cash app",
    "wire", "ach", "sent to", "received from", "p2p",
    "peer to peer", "payment sent", "payment received",
    "fund transfer", "money transfer", "neft", "rtgs", "imps"],
  "ArrowLeftRight", "#6366f1", undefined,
  "Inter-account movement excluded from cash-flow totals. Ownership (own accounts vs. external) is resolved at the transaction level via the self_transfer review flag, not by this category."));

Category.register(new Category("bills", "Bills & Payments", true,
  ["bill payment", "bill pay", "payment to", "pmt", "payment-debit", "autopay"],
  "Receipt", "#f59e0b", "needs",
  "Utility bills, subscriptions, recurring payments, and other bill-payment transactions."));

Category.register(new Category("cc_bill_payment", "CC Bill Payment", false,
  ["cc payment", "credit card payment", "card payment",
    "credit card bill", "card bill"],
  "CreditCard", "#a855f7", "needs",
  "Credit card bill payments — bank-side debits for paying off credit card balances."));

Category.register(new Category("loans", "Loans", false,
  ["loan emi", "loan repayment", "personal loan", "home loan",
    "car loan", "auto loan", "education loan", "emi"],
  "Landmark", "#dc2626", "needs",
  "Loan repayments — EMI payments for personal loans, home loans, car loans, education loans."));

Category.register(new Category("investment", "Investment", true,
  ["stock", "stocks", "dividend", "crypto", "bitcoin", "ethereum",
    "trading", "investment", "brokerage", "fidelity", "vanguard",
    "schwab", "robinhood", "coinbase", "binance", "etf", "mutual fund",
    "401k", "ira", "securities"],
  "LineChart", "#0891b2", "saves",
  "Brokerage, securities, mutual funds, crypto, dividends, or investment-related flows."));

Category.register(new Category("insurance", "Insurance", true,
  ["insurance", "premium", "coverage", "policy", "geico",
    "progressive", "state farm", "allstate", "farmers",
    "life insurance", "auto insurance", "home insurance",
    "health insurance", "liability"],
  "Shield", "#64748b", "needs",
  "Insurance premiums and policy-related payments."));

Category.register(new Category("education", "Education", true,
  ["tuition", "school", "university", "college", "course",
    "books", "textbook", "education", "learning", "udemy",
    "coursera", "edx", "skillshare", "masterclass", "training",
    "workshop", "seminar", "class", "lesson", "tutoring"],
  "GraduationCap", "#7c3aed", "wants",
  "Tuition, courses, books, training, tutoring, and education-related payments."));

Category.register(new Category("travel", "Travel", true,
  ["airline", "flight", "hotel", "booking", "airbnb",
    "expedia", "booking.com", "travel", "vacation", "trip",
    "united", "delta", "american airlines", "southwest",
    "jetblue", "marriott", "hilton", "hyatt", "rental car",
    "hertz", "enterprise", "avis", "lyft", "uber"],
  "Plane", "#0ea5e9", "wants",
  "Flights, hotels, lodging, rental cars, and trip-related spending."));

Category.register(new Category("fees", "Fees & Charges", false,
  ["fee", "charges", "penalty", "late fee", "service fee",
    "annual fee", "maintenance fee", "transaction fee",
    "fcy markup", "foreign currency", "currency conversion",
    "bank fee", "processing fee", "admin fee", "administrative"],
  "AlertCircle", "#f43f5e", "needs",
  "Bank fees, service fees, annual fees, processing fees, and similar charges. Not budgetable — mostly unpredictable penalties and fixed charges."));

Category.register(new Category("taxes", "Taxes", false,
  ["tax", "gst", "vat", "cess", "duty", "tds", "tax deducted",
    "igst", "cgst", "sgst", "ugst", "sales tax", "income tax",
    "property tax", "stamp duty", "excise", "levy", "impost"],
  "Receipt", "#d946ef", "needs",
  "Tax, GST, VAT, IGST, SGST, duty, cess, and similar tax-related debits. Not budgetable."));

Category.register(new Category("cash_withdrawal", "Cash Withdrawal", false,
  ["atm", "cash withdrawal", "cash withdraw", "withdrawal", "cash out", "atm withdrawal"],
  "Banknote", "#9ca3af", undefined,
  "Cash withdrawn at an ATM. Routed to the withdrawal subtype; excluded from categorized spending."));

Category.register(new Category("adjustment", "Adjustment", false,
  ["adjustment", "bank correction", "corrected", "reversal adjustment", "balance adjustment"],
  "Wrench", "#9ca3af", undefined,
  "Bank corrections and none-of-the-above movements. Role follows direction. Not budgetable."));

// Uncategorized spending is visible in dashboards, not silently hidden, and is
// budgetable as a misc bucket.
Category.register(new Category("other", "Other", true,
  [],
  "HelpCircle", "#6b7280", "saves",
  "Uncategorized spending. Use when the merchant or purpose is genuinely unclear."));

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
