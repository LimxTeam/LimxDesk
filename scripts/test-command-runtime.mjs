import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "packages", "console", "src", "command", "commandRuntime.ts");
const source = await fs.readFile(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

const cacheDir = path.join(root, "node_modules", ".cache");
await fs.mkdir(cacheDir, { recursive: true });
const tempDir = await fs.mkdtemp(path.join(cacheDir, "limxdesk-command-runtime-"));
const modulePath = path.join(tempDir, "commandRuntime.mjs");
await fs.writeFile(modulePath, compiled, "utf8");

try {
  const runtime = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
  const {
    commandLineText,
    commandNumberSet,
    commandObjectNumbers,
    commandSourceTargetSlotPair,
    parseCommandText,
  } = runtime;

  const fixtureRange = parseCommandText("Fixture 1 Thru 3 + 5 - 2");
  assert.equal(fixtureRange.target, "fixture");
  assert.deepEqual(commandObjectNumbers(fixtureRange, "fixture"), [1, 3, 5]);
  assert.deepEqual(commandNumberSet(fixtureRange), [1, 3, 5]);

  const slashExecutor = parseCommandText("/ 101");
  assert.equal(slashExecutor.target, "executor");
  assert.deepEqual(commandObjectNumbers(slashExecutor, "executor"), [101]);
  assert.equal(commandLineText(slashExecutor), "/ 101");

  const assign = parseCommandText("Assign Sequence 1 At / 101");
  assert.equal(assign.mode, "assign");
  assert.deepEqual(commandObjectNumbers(assign, "sequence"), [1]);
  assert.deepEqual(commandObjectNumbers(assign, "executor"), [101]);
  assert.equal(commandLineText(assign), "assign Sequence 1 At / 101");

  const copyExecutor = parseCommandText("Copy / 101 At / 102");
  assert.deepEqual(commandSourceTargetSlotPair(copyExecutor, "executor"), { source: 101, target: 102 });

  console.log("command runtime tests passed");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
