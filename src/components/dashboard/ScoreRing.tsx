'use client';

import { cn } from '@/lib/utils';

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
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / maxScore) * circumference;
  const offset = circumference - progress;

  // Determine color based on score
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'stroke-success';
    if (score >= 40) return 'stroke-warning';
    return 'stroke-destructive';
  };

  const getLabelColor = (score: number) => {
    if (score >= 70) return 'text-success';
    if (score >= 40) return 'text-warning';
    return 'text-destructive';
  };

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
          className={cn('fill-none transition-all duration-700 ease-out', getScoreColor(score))}
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
        <span className={cn('text-xs font-semibold mt-0.5', getLabelColor(score))}>
          {label}
        </span>
      </div>
    </div>
  );
}
