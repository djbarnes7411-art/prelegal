import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { NdaChat, type ChatEntry } from "./NdaChat";

/* The panel on its own: what it shows, and what the keyboard does to it. */

const MESSAGES: ChatEntry[] = [
  { id: 0, role: "assistant", content: "What are the two companies called?" },
  { id: 1, role: "user", content: "Northwind Labs and Kestrel Analytics." },
];

function setup(overrides: Partial<Parameters<typeof NdaChat>[0]> = {}) {
  const onSend = vi.fn();
  const onRetry = vi.fn();

  render(
    <NdaChat
      messages={MESSAGES}
      sending={false}
      error={null}
      onSend={onSend}
      onRetry={onRetry}
      inputRef={createRef<HTMLTextAreaElement>()}
      {...overrides}
    />,
  );

  return { onSend, onRetry };
}

describe("NdaChat", () => {
  it("shows the conversation so far", () => {
    setup();
    expect(
      screen.getByText("What are the two companies called?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Northwind Labs and Kestrel Analytics."),
    ).toBeInTheDocument();
  });

  it("says who is speaking, for anyone who cannot see the layout", () => {
    setup();
    expect(screen.getByText("You said:")).toBeInTheDocument();
    expect(screen.getByText("Assistant said:")).toBeInTheDocument();
  });

  it("announces new messages without re-reading the whole conversation", () => {
    setup();
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveAttribute("aria-relevant", "additions");
  });

  it("says where the words go, and does not offer to hide it", () => {
    setup();
    expect(screen.getByText(/sent to our AI provider/)).toBeInTheDocument();
  });

  describe("sending", () => {
    it("sends what was typed", async () => {
      const user = userEvent.setup();
      const { onSend } = setup();

      await user.type(screen.getByLabelText("Your message"), "Delaware.");
      await user.click(screen.getByRole("button", { name: "Send" }));

      expect(onSend).toHaveBeenCalledWith("Delaware.");
    });

    it("clears the box afterwards", async () => {
      const user = userEvent.setup();
      setup();

      const input = screen.getByLabelText("Your message");
      await user.type(input, "Delaware.");
      await user.click(screen.getByRole("button", { name: "Send" }));

      expect(input).toHaveValue("");
    });

    it("sends on Enter", async () => {
      const user = userEvent.setup();
      const { onSend } = setup();

      await user.type(screen.getByLabelText("Your message"), "Delaware.{Enter}");

      expect(onSend).toHaveBeenCalledWith("Delaware.");
    });

    it("keeps Shift+Enter for the second line of an address", async () => {
      const user = userEvent.setup();
      const { onSend } = setup();

      const input = screen.getByLabelText("Your message");
      await user.type(input, "410 Bridge St{Shift>}{Enter}{/Shift}Austin, TX");

      expect(onSend).not.toHaveBeenCalled();
      expect(input).toHaveValue("410 Bridge St\nAustin, TX");
    });

    it("ignores whitespace", async () => {
      const user = userEvent.setup();
      const { onSend } = setup();

      await user.type(screen.getByLabelText("Your message"), "   {Enter}");

      expect(onSend).not.toHaveBeenCalled();
    });

    it("will not send an empty message", () => {
      setup();
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    });
  });

  describe("while a reply is coming", () => {
    it("says so where a screen reader will hear it", () => {
      setup({ sending: true });
      expect(screen.getByText("Assistant is replying…")).toBeInTheDocument();
    });

    it("does not send a second message on top of the first", async () => {
      const user = userEvent.setup();
      const { onSend } = setup({ sending: true });

      await user.type(screen.getByLabelText("Your message"), "and Delaware{Enter}");

      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe("when a turn fails", () => {
    it("interrupts with the reason", () => {
      setup({ error: "The assistant is unavailable right now." });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The assistant is unavailable right now.",
      );
    });

    it("offers to try again", async () => {
      const user = userEvent.setup();
      const { onRetry } = setup({ error: "Could not reach the server." });

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(onRetry).toHaveBeenCalled();
    });

    it("leaves the box usable, so the user is not stuck", () => {
      setup({ error: "Could not reach the server." });
      expect(screen.getByLabelText("Your message")).toBeEnabled();
    });
  });
});
