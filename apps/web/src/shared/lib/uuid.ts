const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 経路の params や保存値を送る前の軽い確認。サーバー側の認可の代替ではない。 */
export function isUuidString(value: string): boolean {
  return UUID_PATTERN.test(value);
}
