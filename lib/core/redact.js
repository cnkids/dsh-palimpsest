// 出口脱敏：把从历史会话取回的文本里**已知形态**的凭据打码。
//
// 为什么需要：你三个月前在某个会话里粘过的 API key，今天被检索出来就会进入模型
// 上下文，还会写进当前会话的日志、二次扩散。同类的跨会话检索插件明确承认没做这件事。
//
// 边界要说清楚：这只覆盖已知形态，是纵深防御，**不是保险箱**。
// 非常规格式的密钥照样会漏；真正的防线是 palimpsest 默认只看当前工作目录、
// 外加用标题标记把整段会话排除在检索之外。

/** 打码后的占位文本，带上命中类型，让模型知道这里原来是敏感值。 */
const MASK = '«已打码»';

/**
 * 脱敏规则。
 *
 * 每条正则都刻意写成**有界或线性**的：没有嵌套量词、没有 `.*` 与回溯组合，
 * 既避免灾难性回溯（SonarQube S5852），也不会在长文本上退化。
 * `keep` 表示保留第几个捕获组（例如 `password=` 这种赋值只遮值、留下键）。
 */
const RULES = [
  { label: 'API key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/gu },
  { label: 'SonarQube token', pattern: /\bsq[ap]_[A-Za-z0-9]{16,}/gu },
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/gu },
  { label: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  { label: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu },
  { label: 'Bearer token', pattern: /\bBearer\s[A-Za-z0-9._~+/-]{16,}=*/gu },
  { label: '私钥块', pattern: /-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----/gu },
  {
    label: '赋值型密钥',
    pattern: /(\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)\S{8,}/giu,
    keep: 1,
  },
];

/** 取出 replaceAll 回调里的捕获组（去掉 match、offset、string）。 */
function groupsOf(args) {
  return args.slice(1, Math.max(1, args.length - 2));
}

/**
 * 判断一段「值」其实是变量引用或占位符，而不是真凭据。
 *
 * 真机验证时发现的误报：`-Dsonar.token=$SONAR_TOKEN` 里的 `$SONAR_TOKEN`
 * 会被赋值型规则当成密钥打掉。变量引用、尖括号占位、一串 x/*、
 * 以及 your-/example/placeholder 这类明显的示例值都该放过。
 * @param {string} value 待判断的值。
 * @returns {boolean} 是占位符时为 true。
 */
function looksLikePlaceholder(value) {
  const text = String(value);
  if (!text) return true;
  if (text.includes('$') || text.includes('<') || text.includes('«')) return true;
  if (/^[x*]+$/iu.test(text)) return true;
  return /(?:YOUR|EXAMPLE|PLACEHOLDER|REDACTED|CHANGEME|DUMMY|FAKE)[-_]?/iu.test(text);
}

/** 按一条规则打码，返回新文本与命中数；占位符不计入也不改动。 */
function applyRule(text, rule) {
  let hits = 0;
  const replaced = text.replaceAll(rule.pattern, (...args) => {
    const match = args[0];
    const kept = rule.keep ? String(groupsOf(args)[rule.keep - 1] ?? '') : '';
    const value = rule.keep ? match.slice(kept.length) : match;
    if (looksLikePlaceholder(value)) return match;
    hits += 1;
    return `${kept}${MASK}`;
  });
  return { text: replaced, hits };
}

/**
 * 给一段文本里的已知凭据形态打码。
 * @param {unknown} input 待处理的文本。
 * @returns {{text: string, count: number}} 打码后的文本与命中总数。
 */
export function redact(input) {
  if (typeof input !== 'string' || !input) {
    return { text: typeof input === 'string' ? input : '', count: 0 };
  }
  let text = input;
  let count = 0;
  for (const rule of RULES) {
    const result = applyRule(text, rule);
    text = result.text;
    count += result.hits;
  }
  return { text, count };
}
