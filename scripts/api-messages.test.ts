import { ExtractorLogLevel } from "@microsoft/api-extractor";
import { describe, expect, it } from "vitest";
import { forgottenSymbol, messageCallback } from "./api-messages.ts";

const message = (messageId: string, text: string, logLevel: ExtractorLogLevel) => ({ messageId, text, logLevel, handled: false });

describe("API Extractor's messages", () => {
  it("reads the symbol of a forgotten export", () => {
    expect(forgottenSymbol(message("ae-forgotten-export", 'The symbol "Options" needs to be exported by the entry point index.d.ts', ExtractorLogLevel.Warning))).toBe("Options");
    expect(forgottenSymbol(message("ae-forgotten-export", "A message without a symbol", ExtractorLogLevel.Warning))).toBeUndefined();
    expect(forgottenSymbol(message("ae-wrong-input-file-type", 'The symbol "Options"', ExtractorLogLevel.Warning))).toBeUndefined();
  });

  it("collects forgotten exports and leaves the other errors and warnings to API Extractor", () => {
    const forgot: string[] = [];
    const callback = messageCallback((symbol) => forgot.push(symbol));
    const handled = [
      message("ae-forgotten-export", 'The symbol "Options" needs to be exported', ExtractorLogLevel.Warning),
      message("ae-forgotten-export", "A message without a symbol", ExtractorLogLevel.Warning),
      message("TS2305", "Module has no exported member", ExtractorLogLevel.Error),
      message("ae-extra-release-tag", "An informational message", ExtractorLogLevel.Info),
      message("ae-missing-release-tag", "A verbose message", ExtractorLogLevel.Verbose),
      message("ae-undocumented", "A silenced message", ExtractorLogLevel.None),
    ].map((m) => {
      callback(m);
      return m.handled;
    });
    expect(forgot).toEqual(["Options"]);
    expect(handled).toEqual([true, false, false, true, true, true]);
  });
});
