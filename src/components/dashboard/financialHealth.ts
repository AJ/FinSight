export interface HealthMetric {
  label: string;
  value: number;
  max: number;
  status: string;
  statusType: 'good' | 'warning' | 'bad';
}

export interface FinancialHealthResult {
  totalIncome: number;
  totalExpenses: number;
  totalSavings: number;
  savingsRate: number;
  savingsTrend: number;
  score: number;
  scoreLabel: string;
  metrics: HealthMetric[];
  projectedAnnualSavings: number;
  monthDisplay: string;
  isNegativeSavings: boolean;
  hasData: true;
}

interface TransactionLike {
  date: Date;
  isIncome: boolean;
  isExpense: boolean;
  amount: number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function calculateSavingsTrend(recentSavings: number, prevSavings: number): number {
  if (prevSavings !== 0) {
    return ((recentSavings - prevSavings) / Math.abs(prevSavings)) * 100;
  }
  if (recentSavings !== 0) {
    return recentSavings > 0 ? 100 : -100;
  }
  return 0;
}

export function calculateSavingsRate(recentSavings: number, recentIncome: number): number {
  if (recentIncome > 0) {
    return (recentSavings / recentIncome) * 100;
  }
  return recentSavings < 0 ? -100 : 0;
}

export function calculateFinancialHealthScore(
  savingsRate: number,
  utilizationPercent: number,
  hasCCData: boolean,
): number {
  let score = 50;

  if (savingsRate >= 30) score += 30;
  else if (savingsRate >= 20) score += 25;
  else if (savingsRate >= 10) score += 15;
  else if (savingsRate >= 0) score += 5;
  else if (savingsRate >= -10) score -= 5;
  else if (savingsRate >= -25) score -= 15;
  else score -= 25;

  if (!hasCCData) score += 10;
  else if (utilizationPercent <= 30) score += 20;
  else if (utilizationPercent <= 50) score += 10;
  else if (utilizationPercent <= 70) score += 0;
  else score -= 10;

  return Math.max(0, Math.min(100, score));
}

export function getScoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs Work';
}

export function buildHealthMetrics(
  savingsRate: number,
  utilizationPercent: number,
  hasCCData: boolean,
): HealthMetric[] {
  return [
    {
      label: 'Utilization',
      value: utilizationPercent,
      max: 100,
      status: !hasCCData ? 'N/A' : utilizationPercent <= 30 ? 'Good' : utilizationPercent <= 50 ? 'OK' : 'High',
      statusType: !hasCCData ? 'good' : utilizationPercent <= 30 ? 'good' : utilizationPercent <= 50 ? 'warning' : 'bad',
    },
    {
      label: 'Savings',
      value: Math.max(0, savingsRate),
      max: 100,
      status: savingsRate >= 20 ? 'Excellent' : savingsRate >= 10 ? 'Good' : savingsRate >= 0 ? 'Low' : 'Overspent',
      statusType: savingsRate >= 20 ? 'good' : savingsRate >= 10 ? 'warning' : 'bad',
    },
  ];
}

export function computeMonthlyFinancials(
  transactions: TransactionLike[],
  creditUtilization: number,
  hasCreditCardData: boolean,
): FinancialHealthResult | { hasData: false } {
  if (transactions.length === 0) {
    return { hasData: false };
  }

  // Group by month, filtering out transactions with invalid dates
  const byMonth = new Map<string, TransactionLike[]>();
  const validTransactions: TransactionLike[] = [];
  for (const t of transactions) {
    const date = t.date;
    if (isNaN(date.getTime())) continue;
    validTransactions.push(t);
    const key = getYearMonth(date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(t);
  }

  if (validTransactions.length === 0) {
    return { hasData: false };
  }

  // Compute totals from valid-date transactions only (same set used for monthly grouping)
  const totalIncome = validTransactions.filter((t) => t.isIncome).reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = validTransactions.filter((t) => t.isExpense).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const totalSavings = totalIncome - totalExpenses;
  const savingsRate = calculateSavingsRate(totalSavings, totalIncome);

  const sortedMonths = Array.from(byMonth.keys()).sort((a, b) => b.localeCompare(a));
  const recentMonthKey = sortedMonths[0];
  const prevMonthKey = sortedMonths.length > 1 ? sortedMonths[1] : null;
  const recentTxns = byMonth.get(recentMonthKey) || [];
  const prevTxns = prevMonthKey ? byMonth.get(prevMonthKey) || [] : [];

  const recentMonthSavings = recentTxns.filter((t) => t.isIncome).reduce((sum, t) => sum + t.amount, 0)
    - recentTxns.filter((t) => t.isExpense).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const prevMonthSavings = prevTxns.filter((t) => t.isIncome).reduce((sum, t) => sum + t.amount, 0)
    - prevTxns.filter((t) => t.isExpense).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const savingsTrend = calculateSavingsTrend(recentMonthSavings, prevMonthSavings);

  const utilizationPercent = creditUtilization * 100;
  const score = calculateFinancialHealthScore(savingsRate, utilizationPercent, hasCreditCardData);
  const metrics = buildHealthMetrics(savingsRate, utilizationPercent, hasCreditCardData);

  // Period display (matches hero cards' date range)
  const numMonths = byMonth.size;
  let monthDisplay: string;
  if (numMonths <= 1) {
    const [year, month] = recentMonthKey.split('-');
    monthDisplay = `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
  } else {
    const earliestKey = sortedMonths[sortedMonths.length - 1];
    const [eYear, eMonth] = earliestKey.split('-');
    const [lYear, lMonth] = recentMonthKey.split('-');
    monthDisplay = `${MONTH_NAMES[parseInt(eMonth) - 1]} ${eYear} – ${MONTH_NAMES[parseInt(lMonth) - 1]} ${lYear}`;
  }

  // Projected annual savings based on monthly average
  const avgMonthlySavings = totalSavings / numMonths;

  return {
    totalIncome,
    totalExpenses,
    totalSavings,
    savingsRate,
    savingsTrend,
    score,
    scoreLabel: getScoreLabel(score),
    metrics,
    projectedAnnualSavings: avgMonthlySavings * 12,
    monthDisplay,
    isNegativeSavings: totalSavings < 0,
    hasData: true,
  };
}
