const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  Formatter, FracturedJsonOptions, EolStyle, NumberListAlignment, TableCommaPlacement
} = require("fracturedjsonjs");

const root = path.resolve(__dirname, "..");
const options = new FracturedJsonOptions();
Object.assign(options, {
  IndentSpaces: 2,
  MaxTotalLineLength: 120,
  MaxInlineComplexity: 1,
  MaxCompactArrayComplexity: 1,
  MaxTableRowComplexity: 2,
  AlwaysExpandDepth: 0,
  JsonEolStyle: EolStyle.Lf,
  NumberListAlignment: NumberListAlignment.Decimal,
  TableCommaPlacement: TableCommaPlacement.BeforePadding
});
const formatter = new Formatter();
formatter.Options = options;

function collectJson(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJson(file);
    return entry.isFile() && entry.name.endsWith(".json") ? [file] : [];
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--check")) {
    throw new Error("Usage: node scripts/format-json.cjs [--check]");
  }
  const checkOnly = args.includes("--check");
  // Format scene data and fixtures; npm manifests keep their standard layout.
  const files = ["assets", "tests/fixtures"]
    .flatMap(dir => collectJson(path.join(root, dir))).sort();

  // Validate every result before writing. Reformat preserves numeric text;
  // Serialize/Normalize would unnecessarily rewrite the measured values.
  const changes = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const formatted = formatter.Reformat(source).trimEnd() + "\n";
    assert.deepStrictEqual(JSON.parse(formatted), JSON.parse(source), `JSON data changed: ${file}`);
    if (formatted !== source) changes.push({ file, formatted });
  }

  if (checkOnly) {
    for (const { file } of changes) console.error(`Needs formatting: ${path.relative(root, file)}`);
    console.log(`${files.length} JSON files checked; ${changes.length} need formatting.`);
    if (changes.length) process.exitCode = 1;
    return;
  }
  for (const { file, formatted } of changes) fs.writeFileSync(file, formatted, "utf8");
  console.log(`Formatted ${changes.length} of ${files.length} JSON files; all JSON values preserved.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
