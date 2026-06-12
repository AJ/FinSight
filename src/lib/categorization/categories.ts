import { Category } from "@/models/Category";
import { CategoryType } from "@/models/CategoryType";

// Register all categories at module load time
Category.register(new Category("groceries", "Groceries", CategoryType.Expense,
  ["supermarket", "grocery", "groceries", "walmart", "kroger",
    "whole foods", "costco", "aldi", "safeway", "publix",
    "trader joe", "target", "market", "food", "h-e-b", "meijer",
    "sams club", "bj", "fresh", "produce"],
  "ShoppingCart", "#22c55e", "needs",
  "Supermarkets, grocery stores, fresh produce, food staples, and routine household essentials."));

Category.register(new Category("dining", "Dining", CategoryType.Expense,
  ["restaurant", "cafe", "coffee", "starbucks", "mcdonalds",
    "burger", "pizza", "sushi", "diner", "bistro", "grill",
    "dunkin", "tim hortons", "chipotle", "subway", "domino",
    "papa john", "kfc", "taco bell", "wendys", "doordash",
    "uber eats", "grubhub", "postmates", "eatery", "brasserie",
    "swiggy", "zomato", "blinkit", "zepto", "instamart", "foodpanda",
    "deliveroo", "menulog", "just eat", "skipthedishes"],
  "Utensils", "#f97316", "wants",
  "Restaurants, cafes, coffee shops, bars, takeout, and food delivery."));

Category.register(new Category("transportation", "Transportation", CategoryType.Expense,
  ["gas", "fuel", "shell", "exxon", "chevron", "bp", "mobil",
    "uber", "lyft", "taxi", "parking", "toll", "car wash",
    "auto", "mechanic", "oil change", "tire", "repair",
    "bus", "metro", "transit", "train", "amtrak", "fuel station"],
  "Car", "#3b82f6", "needs",
  "Fuel, public transit, ride-hailing, taxi, parking, tolls, and vehicle upkeep."));

Category.register(new Category("utilities", "Utilities", CategoryType.Expense,
  ["electric", "electricity", "power", "water", "gas bill",
    "internet", "phone", "mobile", "verizon", "at&t", "t-mobile",
    "comcast", "xfinity", "spectrum", "utility", "sewer",
    "garbage", "trash", "heating", "cooling", "pge", "duke energy"],
  "Zap", "#eab308", "needs",
  "Electricity, water, gas, internet, mobile, phone, and other utility bills."));

Category.register(new Category("housing", "Housing", CategoryType.Expense,
  ["rent", "mortgage", "home", "apartment", "lease",
    "maintenance", "repair", "property", "hoa", "condo",
    "landlord", "real estate", "housing"],
  "Home", "#8b5cf6", "needs",
  "Rent, mortgage, housing maintenance, HOA, and property-related costs."));

Category.register(new Category("healthcare", "Healthcare", CategoryType.Expense,
  ["pharmacy", "doctor", "hospital", "medical", "health",
    "dental", "vision", "optometry", "clinic", "urgent care",
    "cvs", "walgreens", "rite aid", "prescription", "medicine",
    "insurance", "copay", "deductible", "lab", "specialist"],
  "Heart", "#ef4444", "needs",
  "Pharmacy, doctor, clinic, hospital, medical treatment, and health-related spending."));

Category.register(new Category("entertainment", "Entertainment", CategoryType.Expense,
  ["netflix", "spotify", "hulu", "disney", "hbo", "amazon prime",
    "youtube", "movie", "cinema", "theater", "concert", "gaming",
    "playstation", "xbox", "nintendo", "steam", "game", "music",
    "apple music", "tidal", "deezer", "audible", "podcast"],
  "Film", "#ec4899", "wants",
  "Streaming, movies, games, concerts, subscriptions, and leisure spending."));

Category.register(new Category("shopping", "Shopping", CategoryType.Expense,
  ["amazon", "ebay", "etsy", "wish", "aliexpress",
    "best buy", "apple store", "google store", "microsoft store",
    "nordstrom", "macy", "jcpenney", "kohl", "ross", "tj maxx",
    "marshalls", "home depot", "lowes", "ikea", "wayfair",
    "retail", "store", "shop", "online", "order"],
  "ShoppingBag", "#14b8a6", "wants",
  "Retail, e-commerce, electronics, apparel, home goods, and general shopping."));

Category.register(new Category("income", "Income", CategoryType.Income,
  ["salary", "paycheck", "deposit", "income", "payment received",
    "wage", "earnings", "credited", "refund",
    "cashback", "dividend", "bonus", "stipend",
    "freelance", "invoice paid", "direct deposit", "payroll"],
  "TrendingUp", "#10b981", undefined,
  "Salary, payroll, freelance income, reimbursements treated as income, and money earned from work."));

Category.register(new Category("interest", "Interest", CategoryType.Income,
  ["interest", "interest credit", "interest paid", "int credit",
    "int. paid", "interest earned", "savings interest",
    "interest income", "int cr", "interest cr"],
  "Percent", "#84cc16", undefined,
  "Interest credited by a bank or financial institution."));

Category.register(new Category("cashback", "Cashback", CategoryType.Income,
  ["cashback", "cash back", "cash_back", "cb", "reward",
    "rewards", "cashback credit", "cashback received",
    "global_value_cash", "gv cash", "cashback adjustment",
    "reward credit", "loyalty cashback", "points redemption",
    "cash reward", "moneyback", "rebate", "gift card",
    "giftcard", "gift-card", "gv", "gift voucher"],
  "Percent", "#fbbf24", undefined,
  "Cashback, reward credits, rebates, gift voucher credits, and similar incentive credits."));

Category.register(new Category("transfer", "Transfer", CategoryType.Excluded,
  ["transfer", "zelle", "venmo", "paypal", "cash app",
    "wire", "ach", "sent to", "received from", "p2p",
    "peer to peer", "payment sent", "payment received",
    "fund transfer", "money transfer", "neft", "rtgs", "imps"],
  "ArrowLeftRight", "#6366f1", undefined,
  "SELF-TRANSFERS ONLY — money moving between the person's own accounts (e.g., 'Self IMPS', 'Own Account Transfer'). Do NOT use for payments to other people or external transfers. For those, use a spending category or flag as suspense."));

Category.register(new Category("bills", "Bills & Payments", CategoryType.Expense,
  ["bill payment", "bill pay", "payment to", "pmt", "payment-debit", "autopay"],
  "Receipt", "#f59e0b", "needs",
  "Utility bills, subscriptions, recurring payments, and other bill-payment transactions."));

Category.register(new Category("cc_bill_payment", "CC Bill Payment", CategoryType.DebtPayment,
  ["cc payment", "credit card payment", "card payment",
    "credit card bill", "card bill", "hdfc billpay",
    "icici billpay", "axis billpay", "sbi card payment"],
  "CreditCard", "#a855f7", "needs",
  "Credit card bill payments — bank-side debits for paying off credit card balances. Includes NEFT/UPI transfers to credit card accounts, autopay debits labeled as CC payment."));

Category.register(new Category("loans", "Loans", CategoryType.DebtPayment,
  ["loan emi", "loan repayment", "personal loan", "home loan",
    "car loan", "auto loan", "education loan", "emi"],
  "Landmark", "#dc2626", "needs",
  "Loan repayments — EMI payments for personal loans, home loans, car loans, education loans. Regular scheduled payments to lending institutions."));

Category.register(new Category("investment", "Investment", CategoryType.Investment,
  ["stock", "stocks", "dividend", "crypto", "bitcoin", "ethereum",
    "trading", "investment", "brokerage", "fidelity", "vanguard",
    "schwab", "robinhood", "coinbase", "binance", "etf", "mutual fund",
    "401k", "ira", "securities"],
  "LineChart", "#0891b2", "saves",
  "Brokerage, securities, mutual funds, crypto, dividends, or investment-related flows."));

Category.register(new Category("insurance", "Insurance", CategoryType.Expense,
  ["insurance", "premium", "coverage", "policy", "geico",
    "progressive", "state farm", "allstate", "farmers",
    "life insurance", "auto insurance", "home insurance",
    "health insurance", "liability"],
  "Shield", "#64748b", "needs",
  "Insurance premiums and policy-related payments."));

Category.register(new Category("education", "Education", CategoryType.Expense,
  ["tuition", "school", "university", "college", "course",
    "books", "textbook", "education", "learning", "udemy",
    "coursera", "edx", "skillshare", "masterclass", "training",
    "workshop", "seminar", "class", "lesson", "tutoring"],
  "GraduationCap", "#7c3aed", "wants",
  "Tuition, courses, books, training, tutoring, and education-related payments."));

Category.register(new Category("travel", "Travel", CategoryType.Expense,
  ["airline", "flight", "hotel", "booking", "airbnb",
    "expedia", "booking.com", "travel", "vacation", "trip",
    "united", "delta", "american airlines", "southwest",
    "jetblue", "marriott", "hilton", "hyatt", "rental car",
    "hertz", "enterprise", "avis", "lyft", "uber"],
  "Plane", "#0ea5e9", "wants",
  "Flights, hotels, lodging, rental cars, and trip-related spending."));

Category.register(new Category("fees", "Fees & Charges", CategoryType.Expense,
  ["fee", "charges", "penalty", "late fee", "service fee",
    "annual fee", "maintenance fee", "transaction fee",
    "fcy markup", "foreign currency", "currency conversion",
    "bank fee", "processing fee", "admin fee", "administrative"],
  "AlertCircle", "#f43f5e", "needs",
  "Bank fees, service fees, annual fees, processing fees, and similar charges."));

Category.register(new Category("taxes", "Taxes", CategoryType.Expense,
  ["tax", "gst", "vat", "cess", "duty", "tds", "tax deducted",
    "igst", "cgst", "sgst", "ugst", "sales tax", "income tax",
    "property tax", "stamp duty", "excise", "levy", "impost"],
  "Receipt", "#d946ef", "needs",
  "Tax, GST, VAT, IGST, SGST, duty, cess, and similar tax-related debits."));

Category.register(new Category("interest-expense", "Interest", CategoryType.Expense,
  ["interest", "finance charge", "interest charged", "interest debited",
    "igp", "interest payment", "loan interest", "credit interest",
    "overdue interest", "penal interest", "interest on"],
  "Percent", "#a855f7", "saves",
  "Interest charged as an expense, finance charges, overdue interest, and penal interest."));

// Intentionally changed from Excluded to Expense — uncategorized spending should be visible
// in dashboards, not silently hidden. Existing users will see a one-time shift in spending
// totals for any months with other-categorized transactions.
Category.register(new Category("other", "Other", CategoryType.Expense,
  [],
  "HelpCircle", "#6b7280", "saves",
  "Uncategorized spending. Use when the merchant or purpose is genuinely unclear. Debits will appear as spending; credits as income."));

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
