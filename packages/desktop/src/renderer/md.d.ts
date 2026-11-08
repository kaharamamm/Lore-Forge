/** Markdown files bundled as text (build.mjs: loader '.md': 'text'), such as the changelog for Patch notes. */
declare module '*.md' {
  const text: string;
  export default text;
}
