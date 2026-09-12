import { ProbePanel } from "@/features/foundation";

export function HomeScreen() {
  return (
    <main>
      <h1>Tomotabi M0</h1>
      <p>
        開発基盤の確認ページです。旅行・精算・認証はまだありません。ここに見える
        カウンタは互換性検証用で、完成した機能ではありません。
      </p>
      <ProbePanel />
    </main>
  );
}
