import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { randomUUID } from 'crypto';

// 요청 데이터 타입 정의
interface SubscriptionWebhookRequest {
  payment_id: string;
  status: 'Paid' | 'Cancelled';
}

// 응답 데이터 타입 정의
interface SubscriptionWebhookResponse {
  success: boolean;
}

// Portone 결제 정보 타입
interface PortonePayment {
  id: string;
  status: string;
  amount: {
    total: number;
  };
  billingKey?: string;
  orderName: string;
  customer: {
    id: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    // 요청 본문 파싱
    const body: SubscriptionWebhookRequest = await request.json();

    // 필수 필드 검증
    if (!body.payment_id || !body.status) {
      return NextResponse.json(
        { success: false, error: '필수 필드가 누락되었습니다.' },
        { status: 400 }
      );
    }

    // Portone Secret Key (환경 변수에서 가져오기)
    const portoneSecretKey = process.env.PORTONE_API_SECRET;
    if (!portoneSecretKey) {
      return NextResponse.json(
        { success: false, error: 'Portone Secret Key가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    // Paid 시나리오 처리
    if (body.status === 'Paid') {
      // 2-1-1) paymentId의 결제정보를 조회
      const portoneApiUrl = `https://api.portone.io/payments/${encodeURIComponent(body.payment_id)}`;

      const portoneResponse = await fetch(portoneApiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `PortOne ${portoneSecretKey}`,
        },
      });

      if (!portoneResponse.ok) {
        const errorData = await portoneResponse.json().catch(() => ({}));
        console.error('Portone 결제 조회 오류:', errorData);
        return NextResponse.json(
          { success: false, error: '결제 정보 조회에 실패했습니다.' },
          { status: portoneResponse.status }
        );
      }

      const paymentInfo: PortonePayment = await portoneResponse.json();

      // 빌링키가 없으면 구독 결제가 아니므로 에러
      if (!paymentInfo.billingKey) {
        return NextResponse.json(
          { success: false, error: '빌링키가 존재하지 않습니다.' },
          { status: 400 }
        );
      }

      // 2-1-2) supabase의 payment 테이블에 등록
      const now = new Date();
      const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 현재시각 + 30일

      // end_at을 한국 시간으로 변환 (UTC + 9시간)
      const endAtKST = new Date(endAt.getTime() + 9 * 60 * 60 * 1000);
      // end_at + 1일 밤 11:59:59 (한국시간 기준) => UTC로 변환
      const endGraceAtKST = new Date(endAtKST);
      endGraceAtKST.setDate(endGraceAtKST.getDate() + 1);
      endGraceAtKST.setHours(23, 59, 59, 0);
      // 한국 시간을 UTC로 변환 (9시간 빼기)
      const endGraceAt = new Date(endGraceAtKST.getTime() - 9 * 60 * 60 * 1000);

      // end_at + 1일 오전 10시~11시 사이 임의 시각 (한국시간 기준) => UTC로 변환
      const nextScheduleAtKST = new Date(endAtKST);
      nextScheduleAtKST.setDate(nextScheduleAtKST.getDate() + 1);
      const randomHour = 10 + Math.floor(Math.random() * 2); // 10 또는 11
      const randomMinute = Math.floor(Math.random() * 60); // 0~59
      nextScheduleAtKST.setHours(randomHour, randomMinute, 0, 0);
      // 한국 시간을 UTC로 변환 (9시간 빼기)
      const nextScheduleAt = new Date(nextScheduleAtKST.getTime() - 9 * 60 * 60 * 1000);

      // next_schedule_id 생성
      const nextScheduleId = randomUUID();

      // Supabase에 저장
      const { error: insertError } = await supabase.from('payment').insert({
        transaction_key: paymentInfo.id,
        amount: paymentInfo.amount.total,
        status: 'Paid',
        start_at: now.toISOString(),
        end_at: endAt.toISOString(),
        end_grace_at: endGraceAt.toISOString(),
        next_schedule_at: nextScheduleAt.toISOString(),
        next_schedule_id: nextScheduleId,
      });

      if (insertError) {
        console.error('Supabase 저장 오류:', insertError);
        return NextResponse.json(
          { success: false, error: '결제 정보 저장에 실패했습니다.' },
          { status: 500 }
        );
      }

      // 2-2-1) 포트원에 다음달 구독결제를 예약
      const scheduleApiUrl = `https://api.portone.io/payments/${encodeURIComponent(nextScheduleId)}/schedule`;

      const scheduleRequestBody = {
        payment: {
          billingKey: paymentInfo.billingKey,
          orderName: paymentInfo.orderName,
          customer: {
            id: paymentInfo.customer.id,
          },
          amount: {
            total: paymentInfo.amount.total,
          },
          currency: 'KRW',
        },
        timeToPay: nextScheduleAt.toISOString(),
      };

      const scheduleResponse = await fetch(scheduleApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `PortOne ${portoneSecretKey}`,
        },
        body: JSON.stringify(scheduleRequestBody),
      });

      if (!scheduleResponse.ok) {
        const errorData = await scheduleResponse.json().catch(() => ({}));
        console.error('Portone 구독 예약 오류:', errorData);
        // 예약 실패해도 이미 DB에 저장했으므로 경고만 로그
        console.warn('구독 예약에 실패했지만 결제 정보는 저장되었습니다.');
      }
    }

    // Cancelled 시나리오는 현재 구현하지 않음 (필요시 추가)

    const response: SubscriptionWebhookResponse = {
      success: true,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('구독 웹훅 API 오류:', error);
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

