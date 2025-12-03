import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import axios from 'axios';

// Supabase 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 포트원 API 설정
const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET!;
const PORTONE_API_BASE = 'https://api.portone.io';

// 타입 정의
interface WebhookPayload {
  payment_id: string;
  status: 'Paid' | 'Cancelled';
}

interface PortonePayment {
  id: string;
  amount: {
    total: number;
  };
  orderName: string;
  billingKey?: string;
  customer: {
    id: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    // 1. 웹훅 페이로드 파싱
    const payload: WebhookPayload = await request.json();
    console.log('포트원 웹훅 수신:', payload);

    const paymentId = payload.payment_id;

    // 2. Paid 시나리오 처리
    if (payload.status === 'Paid') {
      return await handlePaidScenario(paymentId);
    }

    // 3. Cancelled 시나리오 처리
    if (payload.status === 'Cancelled') {
      return await handleCancelledScenario(paymentId);
    }

    // 4. 알 수 없는 상태
    console.log('알 수 없는 상태:', payload.status);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('웹훅 처리 중 오류 발생:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류' 
      },
      { status: 500 }
    );
  }
}

// Paid 시나리오 처리 함수
async function handlePaidScenario(paymentId: string) {

  // 2-1-1) paymentId의 결제정보를 조회
  console.log('결제 정보 조회 중:', paymentId);
  const paymentResponse = await fetch(`${PORTONE_API_BASE}/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `PortOne ${PORTONE_API_SECRET}`,
    },
  });

  if (!paymentResponse.ok) {
    const errorText = await paymentResponse.text();
    console.error('포트원 결제 정보 조회 실패:', errorText);
    throw new Error(`포트원 결제 정보 조회 실패: ${paymentResponse.status}`);
  }

  const paymentData: PortonePayment = await paymentResponse.json();
  console.log('결제 정보 조회 성공:', paymentData);

  // 2-1-2) 날짜 계산 (한국시간 기준으로 계산 후 UTC로 변환)
  const now = new Date();
  const startAt = now.toISOString();
  
  const endAt = new Date(now);
  endAt.setDate(endAt.getDate() + 30);
  
  // end_grace_at: end_at + 1일 밤 11:59:59(한국시간 기준) => UTC로 변환
  const endGraceAtKST = new Date(endAt);
  endGraceAtKST.setDate(endGraceAtKST.getDate() + 1);
  endGraceAtKST.setHours(23, 59, 59, 999); // 한국시간 23:59:59
  // 한국시간(KST)은 UTC+9이므로 UTC로 변환하려면 9시간 빼야 함
  const endGraceAt = new Date(endGraceAtKST.getTime() - 9 * 60 * 60 * 1000);
  
  // next_schedule_at: end_at + 1일 오전 10시~11시(한국시간 기준) 사이 임의 시각 => UTC로 변환
  const nextScheduleAtKST = new Date(endAt);
  nextScheduleAtKST.setDate(nextScheduleAtKST.getDate() + 1);
  const randomMinutes = Math.floor(Math.random() * 60); // 0~59분
  nextScheduleAtKST.setHours(10, randomMinutes, 0, 0); // 한국시간 10시 00분 ~ 10시 59분
  // 한국시간(KST)은 UTC+9이므로 UTC로 변환하려면 9시간 빼야 함
  const nextScheduleAt = new Date(nextScheduleAtKST.getTime() - 9 * 60 * 60 * 1000);
  
  const nextScheduleId = randomUUID();

  // 2-1-2) supabase의 테이블에 등록
  console.log('Supabase에 결제 정보 저장 중...');
  const { data: paymentRecord, error: insertError } = await supabase
    .from('payment')
    .insert({
      transaction_key: paymentId,
      amount: paymentData.amount.total,
      status: 'Paid',
      start_at: startAt,
      end_at: endAt.toISOString(),
      end_grace_at: endGraceAt.toISOString(),
      next_schedule_at: nextScheduleAt.toISOString(),
      next_schedule_id: nextScheduleId,
    })
    .select()
    .single();

  if (insertError) {
    console.error('Supabase 저장 실패:', insertError);
    throw new Error(`Supabase 저장 실패: ${insertError.message}`);
  }

  console.log('Supabase 저장 성공:', paymentRecord);

  // 2-2) 다음달구독예약시나리오
  if (paymentData.billingKey) {
    console.log('다음 달 구독 예약 중...');
    
    // 2-2-1) 포트원에 다음달 구독결제를 예약
    const scheduleResponse = await fetch(
      `${PORTONE_API_BASE}/payments/${nextScheduleId}/schedule`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `PortOne ${PORTONE_API_SECRET}`,
        },
        body: JSON.stringify({
          payment: {
            billingKey: paymentData.billingKey,
            orderName: paymentData.orderName,
            customer: {
              id: paymentData.customer.id,
            },
            amount: {
              total: paymentData.amount.total,
            },
            currency: 'KRW',
          },
          timeToPay: nextScheduleAt.toISOString(),
        }),
      }
    );

    if (!scheduleResponse.ok) {
      const errorText = await scheduleResponse.text();
      console.error('포트원 스케줄 등록 실패:', errorText);
      // 스케줄 등록 실패는 로그만 남기고 성공 응답 반환 (결제 저장은 성공했으므로)
    } else {
      console.log('다음 달 구독 예약 성공');
    }
  } else {
    console.log('billingKey가 없어 구독 예약을 건너뜁니다.');
  }

  // 성공 응답
  return NextResponse.json({ 
    success: true,
    message: '웹훅 처리 완료',
    payment: paymentRecord
  });
}

// Cancelled 시나리오 처리 함수
async function handleCancelledScenario(paymentId: string) {
  // 3-1) 구독결제취소시나리오
  // 3-1-1) supabase의 테이블에서 조회
  console.log('Supabase에서 결제 정보 조회 중:', paymentId);
  const { data: existingPayment, error: selectError } = await supabase
    .from('payment')
    .select('*')
    .eq('transaction_key', paymentId)
    .eq('status', 'Paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (selectError || !existingPayment) {
    console.error('Supabase 조회 실패:', selectError);
    throw new Error(`결제 정보를 찾을 수 없습니다: ${selectError?.message || '결제 정보 없음'}`);
  }

  console.log('결제 정보 조회 성공:', existingPayment);

  // 3-1-2) supabase의 테이블에 취소 정보 등록
  console.log('Supabase에 취소 정보 저장 중...');
  const { data: cancelRecord, error: insertError } = await supabase
    .from('payment')
    .insert({
      transaction_key: existingPayment.transaction_key,
      amount: -existingPayment.amount,
      status: 'Cancel',
      start_at: existingPayment.start_at,
      end_at: existingPayment.end_at,
      end_grace_at: existingPayment.end_grace_at,
      next_schedule_at: existingPayment.next_schedule_at,
      next_schedule_id: existingPayment.next_schedule_id,
    })
    .select()
    .single();

  if (insertError) {
    console.error('Supabase 취소 정보 저장 실패:', insertError);
    throw new Error(`Supabase 취소 정보 저장 실패: ${insertError.message}`);
  }

  console.log('Supabase 취소 정보 저장 성공:', cancelRecord);

  // 3-2) 다음달구독예약취소시나리오
  if (existingPayment.next_schedule_id) {
    try {
      // 3-2-1) 결제정보를 조회
      console.log('포트원에서 결제 정보 조회 중:', paymentId);
      const paymentResponse = await fetch(`${PORTONE_API_BASE}/payments/${paymentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `PortOne ${PORTONE_API_SECRET}`,
        },
      });

      if (!paymentResponse.ok) {
        const errorText = await paymentResponse.text();
        console.error('포트원 결제 정보 조회 실패:', errorText);
        throw new Error(`포트원 결제 정보 조회 실패: ${paymentResponse.status}`);
      }

      const paymentData: PortonePayment = await paymentResponse.json();
      console.log('결제 정보 조회 성공:', paymentData);

      if (paymentData.billingKey) {
        // 3-2-2) 예약된 결제정보를 조회 (GET with body - axios 사용)
        console.log('예약된 결제 정보 조회 중...');
        const nextScheduleAtDate = new Date(existingPayment.next_schedule_at);
        const fromDate = new Date(nextScheduleAtDate);
        fromDate.setDate(fromDate.getDate() - 1);
        const untilDate = new Date(nextScheduleAtDate);
        untilDate.setDate(untilDate.getDate() + 1);

        const scheduleListResponse = await axios.request({
          method: 'GET',
          url: `${PORTONE_API_BASE}/payment-schedules`,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `PortOne ${PORTONE_API_SECRET}`,
          },
          data: {
            filter: {
              billingKey: paymentData.billingKey,
              from: fromDate.toISOString(),
              until: untilDate.toISOString(),
            },
          },
        });

        console.log('예약된 결제 정보 조회 성공:', scheduleListResponse.data);

        // 3-2-3) next_schedule_id와 일치하는 객체 추출
        const items = scheduleListResponse.data?.items || [];
        const matchingSchedule = items.find(
          (item: { paymentId?: string }) => item.paymentId === existingPayment.next_schedule_id
        );

        if (matchingSchedule) {
          console.log('일치하는 예약 결제 정보 발견:', matchingSchedule);

          // 3-2-4) 포트원에 다음달 구독예약을 취소
          console.log('예약된 결제 취소 중...');
          const cancelScheduleResponse = await fetch(
            `${PORTONE_API_BASE}/payment-schedules`,
            {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `PortOne ${PORTONE_API_SECRET}`,
              },
              body: JSON.stringify({
                scheduleIds: [matchingSchedule.id],
              }),
            }
          );

          if (!cancelScheduleResponse.ok) {
            const errorText = await cancelScheduleResponse.text();
            console.error('포트원 예약 취소 실패:', errorText);
            // 예약 취소 실패는 로그만 남기고 성공 응답 반환
          } else {
            console.log('예약된 결제 취소 성공');
          }
        } else {
          console.log('일치하는 예약 결제 정보를 찾을 수 없습니다.');
        }
      } else {
        console.log('billingKey가 없어 예약 취소를 건너뜁니다.');
      }
    } catch (error) {
      console.error('예약 취소 처리 중 오류 발생:', error);
      // 예약 취소 실패는 로그만 남기고 성공 응답 반환 (결제 취소 저장은 성공했으므로)
    }
  } else {
    console.log('next_schedule_id가 없어 예약 취소를 건너뜁니다.');
  }

  // 성공 응답
  return NextResponse.json({ 
    success: true,
    message: '취소 처리 완료',
    payment: cancelRecord
  });
}

