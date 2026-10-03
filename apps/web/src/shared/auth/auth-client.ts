import { createAuthClient } from "better-auth/react";

// baseURLを指定しない = 同一オリジンの /api/authを使う（Nextのrewrite経由でAPIへ届く）。
// webに秘密値は置かない。useSessionは公開していないget-sessionに依存するため使わない。
export const authClient = createAuthClient();
