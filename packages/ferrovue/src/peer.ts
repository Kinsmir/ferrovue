export function isMissing(error: unknown, name: string): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return (
    (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
    typeof message === "string" &&
    (message.includes(`'${name}'`) || message.includes(`"${name}"`))
  );
}

export function missingPeer(name: string, needs: string, cause: unknown): Error {
  return new Error(`ferrovue/testing: ${needs}, which needs \`${name}\`: install it in your project (\`pnpm add -D ${name}\`, or your package manager's equivalent)`, { cause });
}

export async function peer<T>(name: string, needs: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    throw isMissing(error, name) ? missingPeer(name, needs, error) : error;
  }
}
