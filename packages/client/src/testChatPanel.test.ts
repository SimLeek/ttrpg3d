import { describe, it, expect, beforeEach } from "vitest";
import { mountTestChatPanel } from "./testChatPanel.js";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("mountTestChatPanel", () => {
  it("shows an empty-state message until the first addMessage call", () => {
    mountTestChatPanel(container);
    expect(container.querySelector(".empty")).not.toBeNull();
  });

  it("addMessage appends messages in order and clears the empty state", () => {
    const panel = mountTestChatPanel(container);
    panel.addMessage("Aria: Strength modifier -> 3");
    expect(container.querySelector(".empty")).toBeNull();
    panel.addMessage("Aria: Attack -> 7");

    const lines = Array.from(container.querySelectorAll(".msg")).map((el) => el.textContent);
    expect(lines).toEqual(["Aria: Strength modifier -> 3", "Aria: Attack -> 7"]);
  });
});
