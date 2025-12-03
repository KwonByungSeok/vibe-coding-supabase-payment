'use client';

import { useState, useEffect } from 'react';
import { supabase, Magazine } from '@/lib/supabase';

interface UseMagazineDetailResult {
  magazine: Magazine | null;
  loading: boolean;
  error: string | null;
}

export function useMagazineDetail(id: string): UseMagazineDetailResult {
  const [magazine, setMagazine] = useState<Magazine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMagazine() {
      try {
        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('magazine')
          .select('id, image_url, category, title, description, content, tags')
          .eq('id', id)
          .single();

        if (fetchError) {
          throw fetchError;
        }

        if (!data) {
          throw new Error('Magazine not found');
        }

        let resolvedImageUrl = data.image_url?.trim() ?? null;

        const storageUrlPattern = /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/vibe-coding-storage\/(.+)$/i;
        const storageUrlMatch = resolvedImageUrl ? resolvedImageUrl.match(storageUrlPattern) : null;

        const objectPath = storageUrlMatch ? storageUrlMatch[1] : resolvedImageUrl ?? undefined;
        const isStoragePath =
          !!objectPath && (!resolvedImageUrl || !/^https?:\/\//i.test(resolvedImageUrl) || !!storageUrlMatch);

        if (objectPath && isStoragePath) {
          const { data: transformed, error: transformError } = supabase
            .storage
            .from('vibe-coding-storage')
            .getPublicUrl(objectPath, {
              transform: {
                width: 852,
                resize: 'contain',
              },
            });

          if (transformError) {
            console.error('Error generating thumbnail URL:', transformError);

            const { data: fallback } = supabase
              .storage
              .from('vibe-coding-storage')
              .getPublicUrl(objectPath);

            if (fallback?.publicUrl) {
              resolvedImageUrl = fallback.publicUrl;
            }
          } else if (transformed?.publicUrl) {
            resolvedImageUrl = transformed.publicUrl;
          }
        }

        setMagazine({ ...data, image_url: resolvedImageUrl ?? undefined });
      } catch (err) {
        console.error('Error fetching magazine:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch magazine');
      } finally {
        setLoading(false);
      }
    }

    if (id) {
      fetchMagazine();
    }
  }, [id]);

  return { magazine, loading, error };
}

