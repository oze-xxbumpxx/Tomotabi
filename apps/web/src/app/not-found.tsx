import { ListBullets, MapTrifold } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

// サーバー部品なので、アイコンはReactのcontextを使わないssr版を読み込む。
export default function NotFound() {
  return (
    <main>
      <div className="state-screen">
        <MapTrifold
          size={44}
          className="state-screen-icon"
          aria-hidden="true"
        />
        <h1 className="state-screen-title">ページが見つかりません</h1>
        <p className="state-screen-body">
          URLが間違っているか、ページが移動しました。
        </p>
        <Link href="/trips" className="btn-ink">
          <ListBullets size={16} weight="bold" aria-hidden="true" />
          旅行一覧へ
        </Link>
      </div>
    </main>
  );
}
