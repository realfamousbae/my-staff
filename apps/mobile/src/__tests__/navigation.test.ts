import { describe, expect, it } from "vitest";
import { navigate, type Screen } from "../navigation";

const open = (history: Screen[], screen: Screen) =>
  navigate(history, { type: "open", screen });
const back = (history: Screen[]) => navigate(history, { type: "back" });

describe("Android navigation", () => {
  it("returns from nested card screens to the tab where the card was opened", () => {
    let history = open(["library"], "session");
    history = open(history, "item");
    history = open(history, "catalog");
    history = open(history, "proposal");
    expect(back(history)).toEqual(["library", "session", "item", "catalog"]);
    expect(back(back(history))).toEqual(["library", "session", "item"]);
    expect(back(back(back(history)))).toEqual(["library", "session"]);
  });
  it("returns from editing to the card and from account/trash to settings", () => {
    expect(back(open(open(["library"], "item"), "edit"))).toEqual([
      "library",
      "item",
    ]);
    for (const screen of ["auth", "deleted"] as const)
      expect(back(open(open(["library"], "settings"), screen))).toEqual([
        "library",
        "settings",
      ]);
  });
  it("does not return to an already saved capture or create duplicate cards on back", () => {
    for (const tab of ["library", "session"] as const) {
      const start = open(["library"], tab);
      const camera = open(open(start, "choose-category"), "capture");
      expect(back(camera).at(-1)).toBe("choose-category");
      expect(back(navigate(camera, { type: "captured" }))).toEqual(start);
    }
  });
  it("resets tab history and leaves Android's root exit available", () => {
    expect(open(["library", "session"], "settings")).toEqual([
      "library",
      "settings",
    ]);
    expect(open(["library", "settings"], "library")).toEqual(["library"]);
    expect(back(["library"])).toEqual(["library"]);
    expect(open(["library", "item"], "item")).toEqual(["library", "item"]);
  });
});
