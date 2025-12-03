'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface MagazineItem {
  id: string;
  image_url: string | null;
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

        // image_url 가공 – render → object 변환, 경로는 getPublicUrl 사용, 변환 옵션 없음
        const magazinesWithThumbnails = (data ?? []).map((magazine) => {
          if (!magazine.image_url) return magazine;

          const bucket = 'vibe-coding-storage';
          let url = magazine.image_url;

          if (url.includes('/render/image/')) {
            url = url.replace('/render/image/', '/object/').split('?')[0];
          } else if (!url.startsWith('http')) {
            url = supabase.storage.from(bucket).getPublicUrl(url).data.publicUrl;
          }

          return { ...magazine, image_url: url };
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

