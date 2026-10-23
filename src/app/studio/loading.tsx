import { SkeletonCard, Skeleton } from '@/components/ui/skeleton';

export default function StudioLoading() {
  return (
    <div>
      <div className="mb-9 space-y-3">
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="h-7 w-56 rounded-lg" />
        <Skeleton className="h-3 w-72 rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2">
          <SkeletonCard />
        </div>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
