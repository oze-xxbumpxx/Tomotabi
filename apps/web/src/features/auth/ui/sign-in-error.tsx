import { WarningCircle } from "@phosphor-icons/react";

export function SignInError() {
  return (
    <p role="alert" className="signin-error">
      <WarningCircle size={18} weight="bold" aria-hidden="true" />
      <span>
        ログインできませんでした。時間をおいて、もう一度お試しください。
      </span>
    </p>
  );
}
