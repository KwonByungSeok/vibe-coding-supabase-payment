import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// 요청 데이터 타입 정의
interface PortoneWebhookRequest {
  payment_id: string;
  status: 'Paid' | 'Cancelled';
}

// 응답 데이터 타입 정의
interface PortoneWebhookResponse {
  success: boolean;
}

// 한국시간을 UTC로 변환하는 헬퍼 함수
function convertKSTToUTC(kstDate: Date): Date {
  // 한국시간은 UTC+9이므로 9시간을 빼서 UTC로 변환
  const utcDate = new Date(kstDate.getTime() - 9 * 60 * 60 * 1000);
  return utcDate;
}

// 한국시간 기준으로 특정 시간을 설정하는 헬퍼 함수
function setKSTTime(date: Date, hours: number, minutes: number, seconds: number): Date {
  const kstDate = new Date(date);
  kstDate.setHours(hours, minutes, seconds, 0);
  return kstDate;
}

export async function POST(request: NextRequest) {
  try {
    // 요청 본문 파싱
    const body: PortoneWebhookRequest = await request.json();

    // 필수 필드 검증
    if (!body.payment_id || !body.status) {
      return NextResponse.json(
        { success: false, error: '필수 필드가 누락되었습니다.' },
        { status: 400 }
      );
    }

    // status가 'Paid' 또는 'Cancelled'인지 검증
    if (body.status !== 'Paid' && body.status !== 'Cancelled') {
      return NextResponse.json(
        { success: false, error: 'status는 "Paid" 또는 "Cancelled"여야 합니다.' },
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
      const paymentId = body.payment_id;
      const portoneApiUrl = `https://api.portone.io/payments/${encodeURIComponent(paymentId)}`;

      const paymentResponse = await fetch(portoneApiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `PortOne ${portoneSecretKey}`,
        },
      });

      if (!paymentResponse.ok) {
        const errorData = await paymentResponse.json().catch(() => ({}));
        console.error('Portone 결제 조회 오류:', errorData);
        return NextResponse.json(
          { success: false, error: '결제 정보 조회에 실패했습니다.' },
          { status: paymentResponse.status }
        );
      }

      const paymentData = await paymentResponse.json();

      // 결제 정보에서 필요한 데이터 추출
      const transactionKey = paymentData.paymentId || paymentId;
      const amount = paymentData.amount?.total || 0;
      const billingKey = paymentData.billingKey;
      const orderName = paymentData.orderName;
      const customerId = paymentData.customer?.id;

      // 현재 시각 (UTC)
      const now = new Date();

      // end_at: 현재시각 + 30일
      const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // end_grace_at: end_at + 1일 밤 11:59:59 (한국시간 기준) => UTC로 변환
      const endAtKST = new Date(endAt);
      endAtKST.setDate(endAtKST.getDate() + 1);
      const endGraceAtKST = setKSTTime(endAtKST, 23, 59, 59);
      const endGraceAt = convertKSTToUTC(endGraceAtKST);

      // next_schedule_at: end_at + 1일 오전 10시~11시 사이 임의 시각 (한국시간 기준) => UTC로 변환
      const nextScheduleAtKST = new Date(endAt);
      nextScheduleAtKST.setDate(nextScheduleAtKST.getDate() + 1);
      // 10시~11시 사이 임의 시각 (10시 0분 ~ 10시 59분 59초)
      const randomMinutes = Math.floor(Math.random() * 60);
      const randomSeconds = Math.floor(Math.random() * 60);
      const nextScheduleAtKSTTime = setKSTTime(nextScheduleAtKST, 10, randomMinutes, randomSeconds);
      const nextScheduleAt = convertKSTToUTC(nextScheduleAtKSTTime);

      // next_schedule_id: 임의로 생성한 UUID
      const nextScheduleId = crypto.randomUUID();

      // 2-1-2) supabase의 payment 테이블에 등록
      const { error: supabaseError } = await supabase.from('payment').insert({
        transaction_key: transactionKey,
        amount: amount,
        status: 'Paid',
        start_at: now.toISOString(),
        end_at: endAt.toISOString(),
        end_grace_at: endGraceAt.toISOString(),
        next_schedule_at: nextScheduleAt.toISOString(),
        next_schedule_id: nextScheduleId,
      });

      if (supabaseError) {
        console.error('Supabase 저장 오류:', supabaseError);
        return NextResponse.json(
          { success: false, error: '결제 정보 저장에 실패했습니다.' },
          { status: 500 }
        );
      }

      // 2-2-1) 포트원에 다음달 구독결제를 예약
      if (billingKey && orderName && customerId) {
        const scheduleApiUrl = `https://api.portone.io/payments/${encodeURIComponent(nextScheduleId)}/schedule`;

        const scheduleRequestBody = {
          payment: {
            billingKey: billingKey,
            orderName: orderName,
            customer: {
              id: customerId,
            },
            amount: {
              total: amount,
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
          // 구독 예약 실패해도 성공으로 처리 (이미 DB에는 저장됨)
          console.warn('구독 예약에 실패했지만 결제 정보는 저장되었습니다.');
        }
      }
    }

    // 성공 응답 반환
    const response: PortoneWebhookResponse = {
      success: true,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Portone 웹훅 API 오류:', error);
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
