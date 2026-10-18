/**
 * 指での拡大縮小を止める。iPhoneのSafariは、viewportの`user-scalable=no`を
 * 利用者のために無視するので、2本指の操作をスクリプトで打ち消す
 * （2026-10-18 結合検証環境でユーザーが指示）。
 * 返す関数を呼ぶと、付けた処理を外す。
 */
export function blockPinchZoom(target: Document): () => void {
  // gesturestart / gesturechangeはSafariだけが出す、2本指の拡大・回転の始まりと途中。
  const preventGesture = (event: Event): void => {
    event.preventDefault();
  };
  // 2本以上の指で動かしたときだけ止める。1本指のスクロールは止めない。
  const preventMultiTouchMove = (event: TouchEvent): void => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  };
  target.addEventListener("gesturestart", preventGesture);
  target.addEventListener("gesturechange", preventGesture);
  target.addEventListener("touchmove", preventMultiTouchMove, { passive: false });
  return () => {
    target.removeEventListener("gesturestart", preventGesture);
    target.removeEventListener("gesturechange", preventGesture);
    target.removeEventListener("touchmove", preventMultiTouchMove);
  };
}
