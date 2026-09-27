export type Me = {
  user: {
    id: string;
    displayName: string;
  };
  /** セッションの期限（ISO 8601）。要求ごとに延長はしない。 */
  sessionExpiresAt: string;
};
