"use client";

import { WarningCircle } from "@phosphor-icons/react";
import { SignInButton } from "@/features/auth";

/**
 * デザイン 01・02。error の内容は画面に出さず、原因を問わない一般的な文だけを
 * ボタンの直上に出す（設計書「画面デザイン」、W-03）。
 */
export function SignInScreen({ hasError }: { hasError: boolean }) {
  return (
    <main className="signin">
      <div className="signin-hero">
        {/* SVG アイコンのため next/image ではなく img を使う */}
        <img src="/app-icon-light.svg" alt="" width={96} height={96} />
        <p className="signin-title">tomotabi</p>
      </div>
      <div className="signin-footer">
        {hasError && (
          <p role="alert" className="signin-error">
            <WarningCircle size={18} weight="bold" aria-hidden="true" />
            <span>
              ログインできませんでした。時間をおいて、もう一度お試しください。
            </span>
          </p>
        )}
        <SignInButton />
      </div>
    </main>
  );
}
