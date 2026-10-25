import { ExtractorLogLevel, type ExtractorMessage } from "@microsoft/api-extractor";

const SHOWN: ReadonlySet<ExtractorLogLevel> = new Set([ExtractorLogLevel.Error, ExtractorLogLevel.Warning]);

/** The symbol an `ae-forgotten-export` message names. */
export function forgottenSymbol(message: Pick<ExtractorMessage, "messageId" | "text">): string | undefined {
  if (message.messageId !== "ae-forgotten-export") return undefined;
  return /The symbol "([^"]+)"/.exec(message.text)?.[1];
}

/** An API Extractor message callback: it passes the symbol of each forgotten export to `forgot`,
 * and leaves the other errors and warnings to API Extractor. */
export function messageCallback(forgot: (symbol: string) => void): (message: Pick<ExtractorMessage, "messageId" | "text" | "logLevel" | "handled">) => void {
  return (message) => {
    const symbol = forgottenSymbol(message);
    if (symbol !== undefined) forgot(symbol);
    if (symbol !== undefined || !SHOWN.has(message.logLevel)) message.handled = true;
  };
}
