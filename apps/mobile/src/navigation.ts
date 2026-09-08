export type Screen =
  | "library"
  | "session"
  | "settings"
  | "deleted"
  | "auth"
  | "choose-category"
  | "capture"
  | "item"
  | "edit"
  | "catalog"
  | "proposal";

export type NavigationAction =
  { type: "open"; screen: Screen } | { type: "back" } | { type: "captured" };

export function navigate(
  history: Screen[],
  action: NavigationAction,
): Screen[] {
  if (action.type === "back")
    return history.length > 1 ? history.slice(0, -1) : history;
  if (action.type === "captured")
    return [
      ...history.filter(
        (screen) => screen !== "capture" && screen !== "choose-category",
      ),
      "item",
    ];
  const { screen } = action;
  if (screen === "library") return ["library"];
  if (screen === "session" || screen === "settings") return ["library", screen];
  if (history.at(-1) === screen) return history;
  return [...history, screen];
}
