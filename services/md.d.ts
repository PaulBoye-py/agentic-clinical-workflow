// esbuild bundles .md files as text (see build.mjs loader).
declare module "*.md" {
  const content: string;
  export default content;
}
