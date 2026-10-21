import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";
import { compile } from "json-schema-to-typescript";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
const schemaDirectory = path.join(packageDirectory, "src/schemas");
const generatedDirectory = path.join(packageDirectory, "src/generated");
const distGeneratedDirectory = path.join(packageDirectory, "dist/generated");
const schemas = [
  { file: "catalog.schema.json", name: "catalog", validator: "validateCatalog" },
  { file: "workspace.schema.json", name: "workspace", validator: "validateWorkspace" },
  {
    file: "preferences.schema.json",
    name: "preferences",
    validator: "validatePreferences",
  },
  {
    file: "admin-navigation.schema.json",
    name: "admin-navigation",
    validator: "validateAdminNavigation",
  },
];

await mkdir(generatedDirectory, { recursive: true });
await mkdir(distGeneratedDirectory, { recursive: true });

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  code: { esm: false, source: true },
});
addFormats(ajv);

const validators = {};
for (const entry of schemas) {
  const schemaText = await readFile(path.join(schemaDirectory, entry.file), "utf8");
  const schema = JSON.parse(schemaText);
  const typeSource = await compile(schema, schema.title, {
    bannerComment: "/* Generated from src/schemas. Do not edit directly. */",
  });
  await writeFile(
    path.join(generatedDirectory, `${entry.name}.types.ts`),
    typeSource,
  );
  ajv.addSchema(schema);
  const validate = ajv.getSchema(schema.$id);
  if (!validate) {
    throw new Error(`Could not compile schema ${schema.$id}`);
  }
  validators[entry.validator] = schema.$id;
}

const validatorSource = standaloneCode(ajv, validators);
await writeFile(
  path.join(generatedDirectory, "validators.generated.cjs"),
  validatorSource,
);
await writeFile(
  path.join(distGeneratedDirectory, "validators.generated.cjs"),
  validatorSource,
);
const validatorDeclaration = `export interface ValidationIssue {\n  instancePath: string;\n  schemaPath: string;\n  keyword: string;\n  params: Record<string, unknown>;\n  message?: string;\n}\n\nexport interface StandaloneValidator {\n  (data: unknown): boolean;\n  errors?: ValidationIssue[] | null;\n}\n\n${schemas.map(({ validator }) => `export const ${validator}: StandaloneValidator;`).join("\n")}\n`;
await writeFile(
  path.join(generatedDirectory, "validators.generated.d.cts"),
  validatorDeclaration,
);
await writeFile(
  path.join(distGeneratedDirectory, "validators.generated.d.cts"),
  validatorDeclaration,
);