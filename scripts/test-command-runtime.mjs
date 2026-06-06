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
    activateCommandMode,
    appendCommandToken,
    cancelCommandStep,
    clearCommandEntry,
    commandLineText,
    commandNumberSet,
    commandObjectNumbers,
    commandSourceTargetSlotPair,
    executeCurrentCommand,
    getCommandRuntimeSnapshot,
    parseCommandText,
    pushCommandHistory,
    redoLastCommand,
    registerCommandHandler,
    setCommandTarget,
    undoLastCommand,
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

  clearCommandEntry();
  setCommandTarget("fixture");
  for (const key of ["1", "Thru", "5", "+", "8", "-", "3"]) {
    appendCommandToken(key);
  }
  const keyedFixtureRange = getCommandRuntimeSnapshot();
  assert.equal(keyedFixtureRange.target, "fixture");
  assert.deepEqual(keyedFixtureRange.tokens, ["1", "Thru", "5", "+", "8", "-", "3"]);
  assert.deepEqual(commandNumberSet(keyedFixtureRange), [1, 2, 4, 5, 8]);
  assert.equal(commandLineText(keyedFixtureRange), "Fixture 1 Thru 5 + 8 - 3");

  cancelCommandStep();
  assert.deepEqual(getCommandRuntimeSnapshot().tokens, ["1", "Thru", "5", "+", "8", "-"]);

  clearCommandEntry();
  for (const key of ["/", "1", "0", "1"]) {
    appendCommandToken(key);
  }
  const keyedExecutor = getCommandRuntimeSnapshot();
  assert.equal(keyedExecutor.target, null);
  assert.deepEqual(keyedExecutor.tokens, ["/", "101"]);
  assert.equal(commandLineText(keyedExecutor), "/ 101");

  clearCommandEntry();
  activateCommandMode("assign");
  setCommandTarget("sequence");
  appendCommandToken("1");
  appendCommandToken("At");
  appendCommandToken("/");
  appendCommandToken("1");
  appendCommandToken("0");
  appendCommandToken("1");
  const keyedAssign = getCommandRuntimeSnapshot();
  assert.equal(commandLineText(keyedAssign), "assign Sequence 1 At / 101");

  const handledSnapshots = [];
  const unregister = registerCommandHandler("test-command-runtime", (command) => {
    handledSnapshots.push({
      mode: command.mode,
      target: command.target,
      tokens: [...command.tokens],
      text: commandLineText(command),
    });
    return { handled: true, status: "handled by test" };
  });
  await executeCurrentCommand();
  unregister();
  assert.deepEqual(handledSnapshots, [
    {
      mode: "assign",
      target: "sequence",
      tokens: ["1", "At", "/", "101"],
      text: "assign Sequence 1 At / 101",
    },
  ]);
  assert.equal(getCommandRuntimeSnapshot().status, "handled by test");

  const historyProbe = [];
  pushCommandHistory({
    label: "History Probe",
    undo: () => historyProbe.push("undo"),
    redo: () => historyProbe.push("redo"),
  });
  assert.equal(getCommandRuntimeSnapshot().undoCount, 1);
  await undoLastCommand();
  assert.deepEqual(historyProbe, ["undo"]);
  assert.equal(getCommandRuntimeSnapshot().undoCount, 0);
  assert.equal(getCommandRuntimeSnapshot().redoCount, 1);
  await redoLastCommand();
  assert.deepEqual(historyProbe, ["undo", "redo"]);
  assert.equal(getCommandRuntimeSnapshot().undoCount, 1);
  assert.equal(getCommandRuntimeSnapshot().redoCount, 0);

  console.log("command runtime tests passed");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
