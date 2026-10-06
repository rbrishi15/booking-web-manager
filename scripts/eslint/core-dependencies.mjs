import path from "node:path";

/** Resolve source locations rather than matching spellings that ../ can bypass. */
export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      outward: "{{layer}} must depend inward; {{source}} is outside its allowed core modules.",
      dynamic: "Core module dependencies must use a literal path so their direction can be checked.",
    },
  },
  create(context) {
    const root = context.cwd;
    const file = context.filename;
    const layer = path.relative(root, file).split(path.sep)[0];
    const allowed = layer === "domain" ? ["domain"] : ["domain", "use-cases"];

    function check(node, source) {
      if (source?.type !== "Literal" || typeof source.value !== "string") {
        context.report({ node, messageId: "dynamic" });
        return;
      }
      const specifier = source.value;
      const target = specifier.startsWith("@/")
        ? path.resolve(root, specifier.slice(2))
        : specifier.startsWith(".")
          ? path.resolve(path.dirname(file), specifier)
          : null;
      if (target !== null && allowed.includes(path.relative(root, target).split(path.sep)[0])) return;
      context.report({ node: source, messageId: "outward", data: { layer, source: specifier } });
    }

    return {
      ImportDeclaration(node) { check(node, node.source); },
      ExportNamedDeclaration(node) { if (node.source) check(node, node.source); },
      ExportAllDeclaration(node) { check(node, node.source); },
      ImportExpression(node) { check(node, node.source); },
      TSImportType(node) { check(node, node.argument); },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === "TSExternalModuleReference") check(node, node.moduleReference.expression);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") check(node, node.arguments[0]);
      },
    };
  },
};
