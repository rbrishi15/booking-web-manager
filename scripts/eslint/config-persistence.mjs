/** Composition selects adapters; database operations belong in their implementations. */
export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      persistence: "use-case-config assembles dependencies; move {{operation}}() persistence work into a lib adapter.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const member = node.callee;
        if (member.type !== "MemberExpression") return;
        const operation = member.computed
          ? member.property.type === "Literal" ? member.property.value : undefined
          : member.property.type === "Identifier" ? member.property.name : undefined;
        if (!["query", "from", "rpc"].includes(operation)) return;
        // These standard constructors convert values; they do not select database tables.
        if (operation === "from" && member.object.type === "Identifier"
          && ["Array", "Buffer", "Uint8Array"].includes(member.object.name)) return;
        context.report({ node, messageId: "persistence", data: { operation } });
      },
    };
  },
};
