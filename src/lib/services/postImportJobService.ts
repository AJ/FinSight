import { CategorizedBy } from "@/types";
import { mergeRecategorizedTransactions, recategorizeStoredTransactions } from "@/lib/services/transactionEnrichmentService";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { debugError } from "@/lib/utils/debug";

let pendingBackgroundCategorizationTimer: ReturnType<typeof setTimeout> | null = null;

export function runPostImportJobs(): string[] {
  const triggeredJobs: string[] = [];

  if (scheduleBackgroundCategorization()) {
    triggeredJobs.push("background_categorization");
  }

  if (runStoredTransactionAnomalyDetection()) {
    triggeredJobs.push("anomaly_detection");
  }

  return triggeredJobs;
}

function scheduleBackgroundCategorization(): boolean {
  const { transactions, isCategorizing } = useTransactionStore.getState();
  if (
    pendingBackgroundCategorizationTimer ||
    isCategorizing ||
    transactions.length === 0
  ) {
    return false;
  }

  pendingBackgroundCategorizationTimer = setTimeout(() => {
    pendingBackgroundCategorizationTimer = null;
    void runBackgroundCategorization();
  }, 5000);

  return true;
}

async function runBackgroundCategorization(): Promise<void> {
  const { transactions, isCategorizing } = useTransactionStore.getState();
  if (isCategorizing || transactions.length === 0) {
    return;
  }

  useTransactionStore.setState({
    isCategorizing: true,
    categorizeProgress: "Starting categorization...",
  });

  try {
    const autoCategorizeCandidates = useTransactionStore
      .getState()
      .transactions.filter(
        (transaction) => transaction.categorizedBy !== CategorizedBy.Manual,
      );

    if (autoCategorizeCandidates.length === 0) {
      useTransactionStore.setState({
        isCategorizing: false,
        categorizeProgress: "",
      });
      return;
    }

    const { llmProvider, llmServerUrl, llmModel } = useSettingsStore.getState();
    const recategorizedTransactions = await recategorizeStoredTransactions(
      autoCategorizeCandidates,
      {
        provider: llmProvider,
        baseUrl: llmServerUrl,
        model: llmModel || undefined,
        onProgress: (progress) => {
          useTransactionStore.setState({
            categorizeProgress: `Categorizing... ${progress.processed}/${progress.total}`,
          });
        },
      },
    );

    const categorized = mergeRecategorizedTransactions(
      useTransactionStore.getState().transactions,
      recategorizedTransactions,
    );

    useTransactionStore.setState({
      transactions: categorized,
      isCategorizing: false,
      categorizeProgress: `Completed: ${recategorizedTransactions.length} transactions categorized`,
    });

    setTimeout(() => {
      if (!useTransactionStore.getState().isCategorizing) {
        useTransactionStore.setState({ categorizeProgress: "" });
      }
    }, 3000);
  } catch (error) {
    debugError("BackgroundCategorization", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    useTransactionStore.setState({
      isCategorizing: false,
      categorizeProgress: `Categorization failed: ${errorMessage}`,
    });
    setTimeout(() => {
      if (!useTransactionStore.getState().isCategorizing) {
        useTransactionStore.setState({ categorizeProgress: "" });
      }
    }, 5000);
  }
}

function runStoredTransactionAnomalyDetection(): boolean {
  const { transactions } = useTransactionStore.getState();
  if (transactions.length === 0) {
    return false;
  }

  void import("@/lib/anomaly/detector")
    .then(({ detectAnomalies }) => {
      const updatedTransactions = detectAnomalies(
        useTransactionStore.getState().transactions,
      );
      useTransactionStore.setState({ transactions: updatedTransactions });
    })
    .catch((error) => {
      debugError("AnomalyDetection", error);
    });

  return true;
}
