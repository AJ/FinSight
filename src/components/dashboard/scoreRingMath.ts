export interface RingGeometry {
  radius: number;
  circumference: number;
  progress: number;
  offset: number;
}

export function computeRingGeometry(
  size: number,
  strokeWidth: number,
  score: number,
  maxScore: number = 100,
): RingGeometry {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / maxScore) * circumference;
  const offset = circumference - progress;
  return { radius, circumference, progress, offset };
}

export function getScoreColorClass(score: number): string {
  if (score >= 70) return 'stroke-success';
  if (score >= 40) return 'stroke-warning';
  return 'stroke-destructive';
}

export function getScoreLabelColorClass(score: number): string {
  if (score >= 70) return 'text-success';
  if (score >= 40) return 'text-warning';
  return 'text-destructive';
}
