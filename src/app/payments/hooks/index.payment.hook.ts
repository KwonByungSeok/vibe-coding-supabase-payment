'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestIssueBillingKey, BillingKeyMethod, PgProvider } from '@portone/browser-sdk/v2';

interface UsePaymentReturn {
  isLoading: boolean;
  error: string | null;
  requestBillingKey: () => Promise<void>;
}

export function usePayment(): UsePaymentReturn {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestBillingKey = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 테스트용 사용자 정보 (로그인 기능 없이 테스트 진행)
      const testUserId = `test_user_${Date.now()}`;
      const testCustomerName = '테스트 고객';

      // 환경 변수 확인
      const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
      const channelKey = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY;

      if (!storeId) {
        throw new Error('NEXT_PUBLIC_PORTONE_STORE_ID 환경 변수가 설정되지 않았습니다.');
      }

      if (!channelKey) {
        throw new Error('NEXT_PUBLIC_PORTONE_CHANNEL_KEY 환경 변수가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
      }

      // 포트원 빌링키 발급 요청
      const billingKeyResponse = await requestIssueBillingKey({
        storeId,
        channelKey,
        billingKeyMethod: BillingKeyMethod.CARD,
        issueName: 'IT 매거진 월간 구독',
        issueId: `issue_${testUserId}`,
        displayAmount: 9900,
        currency: 'KRW',
        customer: {
          fullName: testCustomerName,
          phoneNumber: '010-0000-0000',
          email: 'test@example.com',
        },
        card: {},
        redirectUrl: `${window.location.origin}/payments`,
      });

      // 빌링키 발급 실패 처리
      if (!billingKeyResponse || billingKeyResponse.code || !billingKeyResponse.billingKey) {
        const errorMessage = billingKeyResponse?.message || billingKeyResponse?.pgMessage || '빌링키 발급에 실패했습니다.';
        throw new Error(errorMessage);
      }

      const billingKey = billingKeyResponse.billingKey;

      // 결제 API 호출
      const paymentResponse = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billingKey,
          orderName: 'IT 매거진 월간 구독',
          amount: 9900,
          customer: {
            id: testUserId,
          },
        }),
      });

      const paymentResult = await paymentResponse.json();

      if (!paymentResult.success) {
        throw new Error(paymentResult.error || '결제에 실패했습니다.');
      }

      // 성공 처리
      alert('구독에 성공하였습니다.');
      router.push('/magazines');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      setError(errorMessage);
      alert(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    error,
    requestBillingKey,
  };
}

