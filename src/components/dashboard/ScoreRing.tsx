'use client';

import { cn } from '@/lib/utils';
import { computeRingGeometry, getScoreColorClass, getScoreLabelColorClass } from './scoreRingMath';

interface ScoreRingProps {
  score: number;
  maxScore?: number;
  label: string;
  size?: number;
  strokeWidth?: number;
}

export function ScoreRing({
  score,
  maxScore = 100,
  label,
  size = 110,
  strokeWidth = 8,
}: ScoreRingProps) {
  const { radius, circumference, offset } = computeRingGeometry(size, strokeWidth, score, maxScore);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        className="transform -rotate-90"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Background circle */}
        <circle
          className="stroke-muted fill-none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          className={cn('fill-none transition-all duration-700 ease-out', getScoreColorClass(score))}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-foreground">{score}</span>
        <span className="text-xs text-muted-foreground">/{maxScore}</span>
        <span className={cn('text-xs font-semibold mt-0.5', getScoreLabelColorClass(score))}>
          {label}
        </span>
      </div>
    </div>
  );
}
