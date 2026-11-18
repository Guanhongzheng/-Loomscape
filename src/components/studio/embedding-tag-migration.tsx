'use client';

import { useEffect } from 'react';
import { migrateEmbedderTags } from '@/lib/memory';

/**
 * Runs once per browser: older rows carried `api:<model>` without the endpoint
 * hash. Completing the tag keeps every vector valid — no re-embedding, no cost,
 * and no dialog, because there are no real users to migrate yet.
 */
export function EmbeddingTagMigration() {
  useEffect(() => {
    void migrateEmbedderTags()
      .then((count) => {
        if (count > 0) console.info(`[embed] 已静默迁移 ${count} 段旧标签`);
      })
      .catch(() => undefined);
  }, []);
  return null;
}
