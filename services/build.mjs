// Bundles each Lambda into dist/<name>/index.mjs. Terraform zips each folder.
import { build } from "esbuild";
import { readdirSync, existsSync, rmSync } from "node:fs";

const functions = readdirSync(".", { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`${d.name}/handler.ts`))
  .map((d) => d.name);

rmSync("dist", { recursive: true, force: true });

await Promise.all(
  functions.map((name) =>
    build({
      entryPoints: [`${name}/handler.ts`],
      outfile: `dist/${name}/index.mjs`,
      bundle: true,
      platform: "node",
      target: "node24",
      format: "esm",
      sourcemap: true,
      minify: true,
      // Some bundled CJS deps call require(); give ESM output a real one.
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      loader: { ".md": "text" },
      logLevel: "warning",
    }),
  ),
);

console.log(`built: ${functions.join(", ")}`);
