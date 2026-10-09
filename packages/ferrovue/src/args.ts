import { GenError } from "./model.ts";
import type { Deprecation } from "./schema.ts";

/** A command-line option: its names, short one first, the value it takes, and its line in `--help`. */
export interface Flag {
  names: readonly string[];
  value?: string;
  help: string;
  deprecated?: Deprecation;
}

/** The commands `ferrovue` takes, with their lines in `--help`. */
export const COMMANDS: Readonly<Record<string, string>> = {
  init: "scaffold starter ferrovue.config.json and components",
};

/** The options `ferrovue` takes. */
export const FLAGS: readonly Flag[] = [
  { names: ["--check"], help: "check that generated files match committed files without writing" },
  { names: ["-d", "--diff"], help: "show unified diff of changes when checking (use with --check)" },
  { names: ["--format"], value: "<format>", help: "how to write errors and results: human (default) or json" },
  { names: ["--watch"], help: "watch components, stores, routes and config for changes and regenerate" },
  { names: ["-c", "--config"], value: "<path>", help: "path to configuration file (default: ferrovue.config.json)" },
  { names: ["-v", "--version"], help: "print the version and exit" },
  { names: ["-h", "--help"], help: "print this help and exit" },
];

/** What the command line asks for: the command, and each option given by its long name, with its
 * value or `true`. */
export interface Args {
  command: string | null;
  options: Map<string, string | true>;
  /** The name each option was given by, as an error about it quotes it. */
  spelt: Map<string, string>;
  warnings: GenError[];
}

const longName = (flag: Flag): string => flag.names.at(-1)!;

/** `ferrovue --help`. */
export function helpText(flags: readonly Flag[] = FLAGS, commands: Readonly<Record<string, string>> = COMMANDS): string {
  const line = (left: string, help: string): string => `  ${left.padEnd(23)}  ${help}`;
  const option = (flag: Flag): string => {
    const [short, long] = flag.names.length > 1 ? [`${flag.names[0]}, `, longName(flag)] : ["    ", longName(flag)];
    const help = flag.deprecated ? `${flag.help} (deprecated: use ${flag.deprecated.use})` : flag.help;
    return line(`${short}${long}${flag.value ? ` ${flag.value}` : ""}`, help);
  };
  return `Usage: ferrovue [command] [options]

Compile Vue components to Rust render functions, run from the project root.

Commands:
${Object.entries(commands).map(([name, help]) => line(name, help)).join("\n")}

Options:
${flags.map(option).join("\n")}`;
}

/** Read the command line, or say what is wrong with it. A deprecated option gives a warning. */
export function parseArgs(argv: readonly string[], flags: readonly Flag[] = FLAGS, commands: Readonly<Record<string, string>> = COMMANDS): Args | { error: string } {
  const args: Args = { command: null, options: new Map(), spelt: new Map(), warnings: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const flag = flags.find((f) => f.names.includes(name));
    if (!flag) {
      if (arg in commands && args.command === null) {
        args.command = arg;
        continue;
      }
      return { error: `unknown option or command '${arg}'\n\nRun \`ferrovue --help\` for usage.` };
    }
    let value: string | true = true;
    if (flag.value) {
      if (eq !== -1) value = arg.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) value = argv[++i]!;
      else return { error: `option '${name}' requires an argument` };
    } else if (eq !== -1) {
      return { error: `option '${name}' takes no value` };
    }
    if (flag.deprecated) {
      args.warnings.push(new GenError("FV1118", `'${name}' is deprecated since ${flag.deprecated.since}, and goes in the next major release: use ${flag.deprecated.use}`));
    }
    args.options.set(longName(flag), value);
    args.spelt.set(longName(flag), name);
  }
  return args;
}
