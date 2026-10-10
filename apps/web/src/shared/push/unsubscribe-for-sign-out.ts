/**
 * サインアウトの前にブラウザの購読を解除する（F-63）。失敗しても
 * ログアウトは続ける。登録されているService Workerだけを見る
 * （ログアウトのために新しく登録しない）。
 * 呼び出しはeffect以降（navigatorに触れる）。
 */
export async function unsubscribeForSignOut(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration === undefined) {
      return;
    }
    const subscription = await registration.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // 解除できなくてもログアウトは止めない。
  }
}
