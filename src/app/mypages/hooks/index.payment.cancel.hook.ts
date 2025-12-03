import { useRouter } from "next/navigation";

export const usePaymentCancel = () => {
  const router = useRouter();

  /**
   * 구독 취소 처리
   * @param transactionKey - 취소할 결제의 transactionKey
   */
  const handleCancelSubscription = async (transactionKey: string) => {
    try {
      // 1. 구독 취소 API 요청
      const response = await fetch("/api/payments/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionKey,
        }),
      });

      const result = await response.json();

      // 2. 구독 취소 실패 처리
      if (!result.success) {
        alert(
          `구독 취소에 실패했습니다: ${
            result.error || "알 수 없는 오류"
          }`
        );
        return;
      }

      // 3. 구독 취소 성공 처리
      alert("구독이 취소되었습니다.");
      router.push("/magazines");
    } catch (error) {
      console.error("구독 취소 처리 중 오류:", error);
      alert("구독 취소 처리 중 오류가 발생했습니다.");
    }
  };

  return {
    handleCancelSubscription,
  };
};

