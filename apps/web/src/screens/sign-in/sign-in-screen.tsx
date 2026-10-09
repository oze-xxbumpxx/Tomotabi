"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SignInButton, SignInError } from "@/features/auth";

/**
 * デザイン01・02。errorの内容は画面に出さず、原因を問わない一般的な文だけを
 * ボタンの直上に出す（設計書「画面デザイン」、W-03）。
 * 失敗理由のコードが載った ?error= クエリは読み取り後にアドレスバーから消す。
 * 表示中の文は状態に持つため、クエリを消しても残る。ボタンを押して
 * やり直すときはこの文を消し、同じ文が2つ並ばないようにする。
 */
export function SignInScreen({
  hasError,
  pushRemaining = false,
}: {
  hasError: boolean;
  /** X-Push-Stopped: falseで移ってきた。通知を止める案内を出す（F-65）。 */
  pushRemaining?: boolean;
}) {
  const router = useRouter();
  const [showError, setShowError] = useState(hasError);

  useEffect(() => {
    if (hasError || pushRemaining) {
      router.replace("/sign-in");
    }
  }, [hasError, pushRemaining, router]);

  return (
    <main className="signin">
      <div className="signin-hero">
        {/* SVG アイコンのため next/image ではなく img を使う */}
        <img src="/app-icon-light.svg" alt="" width={96} height={96} />
        <p className="signin-title">tomotabi</p>
      </div>
      <div className="signin-footer">
        {pushRemaining && (
          <p className="signin-notice">
            この端末への通知が止まっていない場合は、ログインし直して設定から止めてください
          </p>
        )}
        {showError && <SignInError />}
        <SignInButton onSignInStart={() => setShowError(false)} />
      </div>
    </main>
  );
}
