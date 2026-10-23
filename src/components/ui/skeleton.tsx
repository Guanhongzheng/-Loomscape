import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xl', className)} />;
}

export function SkeletonLine({ width = '100%', className }: { width?: string; className?: string }) {
  return <div className={cn('skeleton h-3 rounded-full', className)} style={{ width }} />;
}

export function SkeletonCard() {
  return (
    <div className="neu rounded-2xl p-6">
      <div className="flex items-start justify-between">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <Skeleton className="h-3 w-10 rounded-full" />
      </div>
      <Skeleton className="mt-6 h-4 w-24 rounded-full" />
      <div className="mt-3 space-y-2">
        <SkeletonLine width="92%" />
        <SkeletonLine width="64%" />
      </div>
    </div>
  );
}
