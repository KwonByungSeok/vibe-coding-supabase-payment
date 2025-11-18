import { NextRequest, NextResponse } from 'next/server';

// 요청 데이터 타입 정의
interface PaymentRequest {
  billingKey: string;
  orderName: string;
  amount: number;
  customer: {
    id: string;
  };
}

// 응답 데이터 타입 정의
interface PaymentResponse {
  success: boolean;
}

export async function POST(request: NextRequest) {
  try {
    // 요청 본문 파싱
    const body: PaymentRequest = await request.json();

    // 필수 필드 검증
    if (!body.billingKey || !body.orderName || !body.amount || !body.customer?.id) {
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

    // paymentId 생성 (UUID 형식)
    const paymentId = crypto.randomUUID();

    // Portone API 엔드포인트
    const portoneApiUrl = `https://api.portone.io/payments/${encodeURIComponent(paymentId)}/billing-key`;

    // Portone API 요청 바디
    const portoneRequestBody = {
      billingKey: body.billingKey,
      orderName: body.orderName,
      amount: {
        total: body.amount,
      },
      customer: {
        id: body.customer.id,
      },
      currency: 'KRW',
    };

    // Portone API 호출
    const portoneResponse = await fetch(portoneApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `PortOne ${portoneSecretKey}`,
      },
      body: JSON.stringify(portoneRequestBody),
    });

    // Portone API 응답 확인
    if (!portoneResponse.ok) {
      const errorData = await portoneResponse.json().catch(() => ({}));
      console.error('Portone API 오류:', errorData);
      return NextResponse.json(
        { success: false, error: '결제 요청에 실패했습니다.' },
        { status: portoneResponse.status }
      );
    }

    // 성공 응답 반환 (DB 저장 없음)
    const response: PaymentResponse = {
      success: true,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('결제 API 오류:', error);
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

