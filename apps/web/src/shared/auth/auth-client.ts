import { createAuthClient } from "better-auth/react";

// baseURL を指定しない = 同一オリジンの /api/auth を使う（Next の rewrite 経由で API へ届く）。
// web に秘密値は置かない。useSession は公開していない get-session に依存するため使わない。
export const authClient = createAuthClient();
