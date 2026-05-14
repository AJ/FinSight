/**
 * Shared formatting for reward points display.
 *
 * Used by both RewardsSummaryCard and RewardPointsCard.
 */

export function formatPoints(pts: number): string {
  if (pts >= 1_000_000) return `${(pts / 1_000_000).toFixed(1)}M`;
  if (pts >= 1_000) return `${(pts / 1_000).toFixed(1)}K`;
  return pts.toLocaleString();
}
