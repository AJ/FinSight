/**
 * Abort signal manager for tracking and cancelling multiple in-flight requests.
 * 
 * Usage:
 * const abortManager = new AbortManager();
 * 
 * // Pass signal to requests
 * await fetch(url, { signal: abortManager.signal() });
 * 
 * // Abort all pending requests
 * abortManager.abortAll();
 */
export class AbortManager {
  private controllers = new Set<AbortController>();

  /**
   * Create a new AbortSignal that is tracked by this manager.
   */
  signal(): AbortSignal {
    const controller = new AbortController();
    this.controllers.add(controller);
    
    // Auto-cleanup when aborted
    controller.signal.addEventListener('abort', () => {
      this.controllers.delete(controller);
    }, { once: true });
    
    return controller.signal;
  }

  /**
   * Abort all tracked requests.
   */
  abortAll(reason?: string) {
    this.controllers.forEach(controller => {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    });
    this.controllers.clear();
  }

  /**
   * Get the number of active (non-aborted) signals.
   */
  get activeCount(): number {
    return this.controllers.size;
  }
}
