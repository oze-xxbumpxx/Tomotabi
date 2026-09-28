import { LockKey, SignIn } from "@phosphor-icons/react";

/**
 * C-1 ログイン切れ。業務データを隠して全面表示する。
 * `unconfirmedTarget`（「旅行」「予定」など）があるときは、結果不明の要求のあとに
 * 401 を受けた場合で、「保存されたか確認できていません」の文を出す。
 */
export function SessionExpired({
  unconfirmedTarget = null,
  onGoToSignIn,
}: {
  unconfirmedTarget?: string | null;
  onGoToSignIn: () => void;
}) {
  return (
    <div className="state-screen">
      <LockKey
        size={44}
        className="state-screen-icon"
        aria-hidden="true"
      />
      <h1 className="state-screen-title">もう一度ログインしてください</h1>
      <p className="state-screen-body">
        {unconfirmedTarget !== null
          ? `保存されたか確認できていません。ログイン後に${unconfirmedTarget}を開いて確かめてください。`
          : "ログインの有効期限が切れました。旅行の内容は、ログインし直すまで表示しません。入力中だった内容は送信していません。"}
      </p>
      <button type="button" className="btn-ink" onClick={onGoToSignIn}>
        <SignIn size={16} weight="bold" aria-hidden="true" />
        ログイン画面へ
      </button>
    </div>
  );
}
