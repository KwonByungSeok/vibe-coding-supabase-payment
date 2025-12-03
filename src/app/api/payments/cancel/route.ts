import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/payments/cancel
 * PortOne v2를 사용한 결제 취소 API
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 요청 데이터 파싱
    const body = await request.json();
    const { transactionKey } = body;

    // 1-1. 필수 데이터 검증
    if (!transactionKey) {
      return NextResponse.json(
        { success: false, error: "transactionKey가 누락되었습니다." },
        { status: 400 }
      );
    }

    // 1-2. 환경 변수 확인
    const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET;
    if (!PORTONE_API_SECRET) {
      return NextResponse.json(
        { success: false, error: "PORTONE_API_SECRET이 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    // 2. PortOne API로 결제 취소 요청
    const cancelResponse = await fetch(
      `https://api.portone.io/payments/${encodeURIComponent(transactionKey)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `PortOne ${PORTONE_API_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: "취소 사유 없음",
        }),
      }
    );

    // 3. PortOne 응답 확인
    if (!cancelResponse.ok) {
      const errorData = await cancelResponse.json().catch(() => ({}));
      console.error("PortOne 결제 취소 실패:", errorData);
      return NextResponse.json(
        {
          success: false,
          error: "결제 취소 처리 중 오류가 발생했습니다.",
          details: errorData,
        },
        { status: cancelResponse.status }
      );
    }

    // 4. 성공 응답 반환 (DB에 저장하지 않음)
    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("API 처리 중 오류:", error);
    return NextResponse.json(
      {
        success: false,
        error: "서버 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

