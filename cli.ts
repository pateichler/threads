#!/usr/bin/env node
import * as path from "path";
import { run as runCompile } from "./compile";
import { clean, sync } from "./preprocess";

const bin = path.basename(process.argv[1]);
const [,, subcommand, ...rest] = process.argv;

function parseFlags(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

switch (subcommand) {
  case "compile": {
    const { flags } = parseFlags(rest);
    if (!flags.input || !flags.output)
      die(`Usage: ${bin} compile --input <dir> --output <dir> [--template <dir>] [--serve] [--port <n>] [--index <id>]`);

    const defaultTemplate = path.join(__dirname, "..", "default-template");
    runCompile({
      input: flags.input,
      output: flags.output,
      template: flags.template ?? defaultTemplate,
      serve: rest.includes("--serve"),
      port: flags.port ? parseInt(flags.port, 10) : 8080,
      index: flags.index ?? null,
    });
    break;
  }

  case "pre": {
    const [command, ...preRest] = rest;
    if (!command)
      die(`Usage: ${bin} pre <command> [options]\nCommands: clean, sync`);

    const { flags, positional } = parseFlags(preRest);

    if (command === "clean") {
      if (!flags.input)
        die(`Usage: ${bin} pre clean --input <dir>`);
      clean(flags.input);
    } else if (command === "sync") {
      if (!flags.input)
        die(`Usage: ${bin} pre sync --input <dir> [--targets <json>] [target-key...]`);
      const targetsFile = flags.targets ?? path.join(flags.input, "targets.json");
      sync(flags.input, targetsFile, positional);
    } else {
      die(`Unknown command: ${command}. Available: clean, sync`);
    }
    break;
  }

  default:
    die(`Usage: ${bin} <subcommand> [options]\nSubcommands: compile, pre`);
}
