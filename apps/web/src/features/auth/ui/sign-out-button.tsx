"use client";

import { StatusText } from "@/shared/ui/status-text";
import { useSignOut } from "../model/use-sign-out";

export function SignOutButton({ onSignedOut }: { onSignedOut: () => void }) {
  const { signOut, pending, failed } = useSignOut();

  return (
    <span className="signout-area">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void signOut().then((ok) => {
            if (ok) {
              onSignedOut();
            }
          });
        }}
      >
        ログアウト
      </button>
      {failed && (
        <StatusText tone="error">
          ログアウトできませんでした。もう一度お試しください。
        </StatusText>
      )}
    </span>
  );
}
