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

        // 1-1) 매거진 데이터 조회
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

        // 1-2) 이미지 URL 가공
        let thumbnailUrl = data.image_url;
        if (thumbnailUrl) {
          const bucket = 'vibe-coding-storage';
          if (thumbnailUrl.includes('/render/image/')) {
            thumbnailUrl = thumbnailUrl.replace('/render/image/', '/object/').split('?')[0];
          } else if (!thumbnailUrl.startsWith('http')) {
            thumbnailUrl = supabase.storage.from(bucket).getPublicUrl(thumbnailUrl).data.publicUrl;
          }
        }

        // 1-3) 실제 데이터로 교체
        setMagazine({
          ...data,
          image_url: thumbnailUrl
        });
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

