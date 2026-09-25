export type UserId = string & { readonly __brand: "UserId" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const UserId = {
  /**
   * @throws 引数が UUID 形式でないとき Error を投げる。
   */
  parse(value: string): UserId {
    if (!UUID_PATTERN.test(value)) {
      throw new Error("UserId must be a UUID");
    }
    return value as UserId;
  },
};
