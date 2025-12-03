'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface MagazineItem {
  id: string;
  image_url: string;
  category: string;
  title: string;
  description: string;
  tags: string[] | null;
}

export const useMagazines = () => {
  const [magazines, setMagazines] = useState<MagazineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMagazines = async () => {
      try {
        setLoading(true);
        setError(null);

        // Supabase에서 데이터 조회 (ANON 키 사용, 10개 제한)
        const { data, error: fetchError } = await supabase
          .from('magazine')
          .select('id, image_url, category, title, description, tags')
          .limit(10);

        if (fetchError) {
          throw fetchError;
        }

        const magazinesWithThumbnails: MagazineItem[] = (data ?? []).map((item) => {
          const rawUrl = item.image_url?.trim() ?? '';

          if (!rawUrl) {
            return { ...item, image_url: '' };
          }

          const storagePublicUrlPattern = /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/vibe-coding-storage\/(.+)$/i;
          const publicMatch = rawUrl.match(storagePublicUrlPattern);

          const objectPath = publicMatch ? publicMatch[1] : rawUrl;
          const isStoragePath = !!objectPath && (!/^https?:\/\//i.test(rawUrl) || !!publicMatch);

          if (!isStoragePath) {
            return { ...item, image_url: rawUrl };
          }

          let resolvedUrl = rawUrl;

          const { data: transformed, error: transformError } = supabase.storage
            .from('vibe-coding-storage')
            .getPublicUrl(objectPath, {
              transform: {
                width: 323,
                resize: 'contain',
              },
            });

          if (transformError) {
            console.error('썸네일 URL 생성 오류:', transformError);

            const { data: fallback } = supabase.storage
              .from('vibe-coding-storage')
              .getPublicUrl(objectPath);

            if (fallback?.publicUrl) {
              resolvedUrl = fallback.publicUrl;
            }
          } else if (transformed?.publicUrl) {
            resolvedUrl = transformed.publicUrl;
          }

          return {
            ...item,
            image_url: resolvedUrl || rawUrl,
          };
        });

        setMagazines(magazinesWithThumbnails);
      } catch (err) {
        console.error('Magazine 조회 오류:', err);
        setError(err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchMagazines();
  }, []);

  return { magazines, loading, error };
};

