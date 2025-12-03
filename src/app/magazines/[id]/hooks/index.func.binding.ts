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

        // 1-2) 이미지 URL 처리
        let thumbnailUrl = data.image_url;
        if (data.image_url) {
          const bucketName = 'vibe-coding-storage';
          
          // render URL이면 무조건 object URL로 변환
          if (data.image_url.includes('/render/image/')) {
            thumbnailUrl = data.image_url.replace('/render/image/', '/object/').split('?')[0];
          } 
          // 전체 URL이지만 render가 아닌 경우 그대로 사용
          else if (data.image_url.startsWith('http')) {
            thumbnailUrl = data.image_url;
          } 
          // 경로만 있는 경우 getPublicUrl로 변환
          else {
            const { data: urlData } = supabase.storage
              .from(bucketName)
              .getPublicUrl(data.image_url);
            thumbnailUrl = urlData.publicUrl;
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

