import { type N } from "./model.ts";

const NODE_NAMES: Record<string, string> = {
  ArrayExpression: "an array literal",
  ArrowFunctionExpression: "an arrow function",
  AssignmentExpression: "an assignment",
  AwaitExpression: "`await`",
  BigIntLiteral: "a `bigint` literal",
  BinaryExpression: "an operator",
  BlockStatement: "a block",
  BreakStatement: "`break`",
  CallExpression: "a call",
  ClassDeclaration: "a class",
  ClassExpression: "a class",
  ConditionalExpression: "a conditional `? :`",
  ContinueStatement: "`continue`",
  DebuggerStatement: "`debugger`",
  DoWhileStatement: "a `do … while` loop",
  EmptyStatement: "an empty statement",
  ExportAllDeclaration: "`export *`",
  ExportDefaultDeclaration: "a default export",
  ExportNamedDeclaration: "an export",
  ExpressionStatement: "an expression statement",
  ForInStatement: "a `for … in` loop",
  ForOfStatement: "a `for … of` loop",
  ForStatement: "a `for` loop",
  FunctionDeclaration: "a function",
  FunctionExpression: "a function",
  Identifier: "a name",
  IfStatement: "an `if` statement",
  Import: "`import()`",
  ImportExpression: "`import()`",
  LabeledStatement: "a labelled statement",
  LogicalExpression: "a logical operator",
  MemberExpression: "a member access",
  MetaProperty: "`import.meta`",
  NewExpression: "`new`",
  ObjectExpression: "an object literal",
  OptionalCallExpression: "an optional call `?.()`",
  OptionalMemberExpression: "an optional member access `?.`",
  RegExpLiteral: "a regular expression",
  ReturnStatement: "`return`",
  SequenceExpression: "a comma expression",
  SpreadElement: "a spread `...`",
  Super: "`super`",
  SwitchStatement: "a `switch` statement",
  TaggedTemplateExpression: "a tagged template",
  TemplateLiteral: "a template literal",
  ThisExpression: "`this`",
  ThrowStatement: "`throw`",
  TryStatement: "a `try` statement",
  TSAnyKeyword: "`any`",
  TSArrayType: "an array type",
  TSBigIntKeyword: "`bigint`",
  TSConditionalType: "a conditional type",
  TSConstructorType: "a constructor type",
  TSDeclareFunction: "a function declared without a body",
  TSEnumDeclaration: "an enum",
  TSExportAssignment: "`export =`",
  TSFunctionType: "a function type",
  TSImportEqualsDeclaration: "`import … = require(…)`",
  TSImportType: "an `import()` type",
  TSIndexedAccessType: "an indexed access type",
  TSInferType: "an `infer` type",
  TSInstantiationExpression: "an instantiation expression",
  TSIntersectionType: "an intersection type",
  TSIntrinsicKeyword: "an intrinsic type",
  TSMappedType: "a mapped type",
  TSModuleDeclaration: "a namespace",
  TSNeverKeyword: "`never`",
  TSNonNullExpression: "a non-null assertion `!`",
  TSObjectKeyword: "`object`",
  TSSymbolKeyword: "`symbol`",
  TSTemplateLiteralType: "a template literal type",
  TSThisType: "the `this` type",
  TSTupleType: "a tuple type",
  TSTypeOperator: "a type operator (`keyof`, `readonly`, `unique`)",
  TSTypePredicate: "a type predicate",
  TSTypeQuery: "a `typeof` type",
  TSBooleanKeyword: "`boolean`",
  TSNullKeyword: "`null`",
  TSNumberKeyword: "`number`",
  TSStringKeyword: "`string`",
  TSUndefinedKeyword: "`undefined`",
  TSUnknownKeyword: "`unknown`",
  TSVoidKeyword: "`void`",
  UnaryExpression: "a unary operator",
  UpdateExpression: "`++` or `--`",
  VariableDeclaration: "a variable declaration",
  WhileStatement: "a `while` loop",
  WithStatement: "`with`",
  YieldExpression: "`yield`",
};

/** A plain name for the kind of a syntax node, as a message names it: "an arrow function", "a tuple
 * type". */
export function nodeName(node: N): string {
  const type: string = node?.type ?? "";
  const named = NODE_NAMES[type];
  if (named !== undefined) return named;
  const words = type.replace(/^TS/, "").replace(/Keyword$/, "").split(/(?=[A-Z])/).join(" ").toLowerCase();
  if (!words) return "a construct";
  return `${/^[aeiou]/.test(words) ? "an" : "a"} ${words}`;
}

/** The names a binding pattern declares, in the order they appear. */
export function patternNames(p: N): string[] {
  switch (p?.type) {
    case "Identifier":
      return [p.name];
    case "ObjectPattern":
      return p.properties.flatMap((q: N) => patternNames(q.type === "RestElement" ? q.argument : q.value));
    case "ArrayPattern":
      return p.elements.flatMap((q: N) => (q ? patternNames(q) : []));
    case "AssignmentPattern":
      return patternNames(p.left);
    case "RestElement":
      return patternNames(p.argument);
    default:
      return [];
  }
}
