// 三个工具共用的输出契约：一段给模型直接阅读的文本。
// 结构化字段留给 presentationMeta，不进入模型上下文。
//
// 注意输出侧 DSL：必填写在属性内的 `required: true`，不是顶层 `required` 数组。

/** 工具输出 schema 与渲染器。 */
export const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      content: { type: 'string', required: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.content ?? '') }],
};
