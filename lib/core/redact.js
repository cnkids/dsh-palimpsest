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

/** 赋值型密钥认得的键名关键词（小写、去掉分隔符后的形态）。 */
const SECRET_KEYWORDS = new Set(['password', 'passwd', 'secret', 'token', 'apikey', 'privatekey']);

/**
 * 把命中的键名切成小写片段。
 * @param {string} key 命中到的键名（可能带结尾的引号、空白与分隔符）。
 * @returns {Array<string>} 片段，例如 `DB_PASSWORD=` → ['db', 'password']。
 */
function keyTokens(key) {
  // 键名命中部分只可能比 `[A-Z0-9_-]` 多出「引号 / 空白 / = / :」，
  // 逐个删掉即可；不做 `+$` 的锚定匹配，避免 SonarQube S5852 的超级线性回溯。
  return String(key)
    .toLowerCase()
    .replaceAll(/["'\s=:]/gu, '')
    .split(/[_-]+/u)
    .filter(Boolean);
}

/**
 * 判断赋值式左边是不是「疑似密钥键名」。
 *
 * 认三种写法（安全审计 F2-A/B）：裸词（`password=`）、前后缀+分隔符
 * （`DB_PASSWORD=`、`access_token=`、`AWS_SECRET_ACCESS_KEY=`），以及被分隔符拆开的
 * `api_key` / `private_key`。判定按**完整片段**比对，所以 `tokenizer=`、`passwordreset=`
 * 这类普通标识不会被误伤。
 *
 * 把关键词判定放进代码而不是塞进正则，是为了让那条正则保持线性、有界，
 * 不必同时承担「匹配赋值式」与「穷举键名」两件事（SonarQube S5843 的复杂度阈值）。
 * @param {string} key 命中到的键名。
 * @returns {boolean} 疑似密钥键名时为 true。
 */
function isSecretKey(key) {
  const tokens = keyTokens(key);
  // api[_-]?key / private[_-]?key 允许被分隔符拆成两段
  return tokens.some(
    (token, index) => SECRET_KEYWORDS.has(token) || (index > 0 && SECRET_KEYWORDS.has(tokens[index - 1] + token)),
  );
}

/**
 * 脱敏规则。
 *
 * 每条正则都刻意写成**有界或线性**的：没有嵌套量词、没有 `.*` 与回溯组合，
 * 既避免灾难性回溯（SonarQube S5852），也不会在长文本上退化。
 * `keep` 表示保留第几个捕获组（例如 `password=` 这种赋值只遮值、留下键）；
 * `accept` 在保留组的基础上再判一次，用来挑出真正的密钥键名。
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
    // 正则只匹配「一个**有界**的标识符 + 可选引号 + `=`/`:` + 有界值」，
    // 键名是不是密钥交给 accept（isSecretKey）判定：早期把关键词、前缀、后缀全塞进
    // 一条正则，既复杂又容易退化。带 `i` 时字符类只写大写，避免 SonarQube S5869
    // 把 `[A-Za-z0-9]` 当成重复字符类。
    // 组 1 = 键名与分隔符（保留），组 2 = 值（打码）。
    pattern: /(\b[A-Z0-9_-]{1,60}["']?\s*[=:]\s*)(["'][^"'\n]{8,}["']|[^\s"',;]{8,})/giu,
    keep: 1,
    accept: isSecretKey,
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
 *
 * 判定**只看值的开头**（安全审计 F2-C）：早期用 `includes('$')` 这种全串包含判定，
 * 于是 `password=hunter$hunter2` 这类真口令会因为值里带个 `$` 被整条放过。
 * 真机误报回归（`$SONAR_TOKEN`、`${SONAR_TOKEN}`、`<your-key-here>`、
 * `your-password-here`、`CHANGEME_please`）全都以开头命中，判定不受影响。
 * @param {string} value 待判断的值。
 * @returns {boolean} 是占位符时为 true。
 */
function looksLikePlaceholder(value) {
  const text = String(value).replaceAll(/^["']|["']$/gu, '');
  if (!text) return true;
  if (/^[$<«]/u.test(text)) return true;
  if (/^[x*]+$/iu.test(text)) return true;
  return /^(?:YOUR|EXAMPLE|PLACEHOLDER|REDACTED|CHANGEME|DUMMY|FAKE)[-_]?/iu.test(text);
}

/** 按一条规则打码，返回新文本与命中数；键名不符或值是占位符时不计入也不改动。 */
function applyRule(text, rule) {
  let hits = 0;
  const replaced = text.replaceAll(rule.pattern, (...args) => {
    const match = args[0];
    const kept = rule.keep ? String(groupsOf(args)[rule.keep - 1] ?? '') : '';
    if (rule.accept && !rule.accept(kept)) return match;
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
