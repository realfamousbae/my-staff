import type { LocalMedia } from "./types";

export function orderOriginals(
  originals: LocalMedia[],
  primaryMediaId: string | null,
): LocalMedia[] {
  const result = [...originals];
  if (primaryMediaId) {
    const primaryIndex = result.findIndex((x) => x.id === primaryMediaId);
    if (primaryIndex > 0) {
      const [primary] = result.splice(primaryIndex, 1);
      if (primary) result.unshift(primary);
    }
  }
  return result;
}
