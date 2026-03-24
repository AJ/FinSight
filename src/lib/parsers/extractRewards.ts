/**
 * Rewards extraction pass (CC only).
 * 
 * Extracts cashback and reward points data from statement.
 */

import { CC_REWARDS_PROMPT } from './prompts';

export interface RewardPoints {
  opening: number | null;
  earned: number | null;
  redeemed: number | null;
  closing: number | null;
}

export interface RewardsOutput {
  cashback: number | null;
  rewardPoints: RewardPoints | null;
}

/**
 * Build rewards extraction prompt.
 */
export function buildRewardsPrompt(normalizedText: string): string {
  // Check if statement has rewards section
  const hasRewardsSection = /reward|cashback|points/i.test(normalizedText);
  
  if (!hasRewardsSection) {
    return '';  // Empty prompt signals no rewards section
  }
  
  return CC_REWARDS_PROMPT.replace('{RAW_TEXT}', normalizedText);
}
