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

        // 조회된 image_url을 썸네일 URL로 변환
        const magazinesWithThumbnails = (data || []).map((magazine: MagazineItem) => {
          // image_url이 null인 경우 그대로 반환
          if (!magazine.image_url) {
            return magazine;
          }

          const bucketName = 'vibe-coding-storage';
          let imageUrl = magazine.image_url;

          // render URL이면 무조건 object URL로 변환
          if (imageUrl.includes('/render/image/')) {
            imageUrl = imageUrl.replace('/render/image/', '/object/').split('?')[0];
          } 
          // 전체 URL이지만 render가 아닌 경우 그대로 사용
          else if (imageUrl.startsWith('http')) {
            imageUrl = imageUrl;
          } 
          // 경로만 있는 경우 getPublicUrl로 변환
          else {
            const { data: urlData } = supabase.storage
              .from(bucketName)
              .getPublicUrl(imageUrl);
            imageUrl = urlData.publicUrl;
          }

          return {
            ...magazine,
            image_url: imageUrl
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

