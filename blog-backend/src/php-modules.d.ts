// Permite importar o .php do plugin como texto (`with { type: "text" }`).
// O Bun embute o conteúdo no bundle em build time; aqui só ensinamos o tipo
// ao TypeScript. Ver routes/plugin.ts.
declare module "*.php" {
  const content: string;
  export default content;
}
