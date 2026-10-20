/** Instance-owned terminal language; model output and backend diagnostics retain their original language. */
const zh = {
  'You': '你',
  'Assistant': '助手',
  'Todos': '任务',
  'Close': '关闭',
  'Find: ': '查找：',
  'type to filter · ↑↓ select · Enter confirm · Esc cancel': '输入筛选 · ↑↓ 选择 · Enter 确认 · Esc 取消',
  '› Message · Enter send · Shift+Enter new line': '› 消息 · Enter 发送 · Shift+Enter 换行',
  '/ commands · @ files · ↑ history · Ctrl-C stop · Ctrl-Q exit': '/ 命令 · @ 文件 · ↑ 历史 · Ctrl-C 停止 · Ctrl-Q 退出',
  'Press Ctrl-C again to exit': '再次按 Ctrl-C 退出',
  '↑↓ scroll · PgUp/PgDn page · / search · n/N next/previous · Esc back': '↑↓ 滚动 · PgUp/PgDn 翻页 · / 搜索 · n/N 下一个/上一个 · Esc 返回',
  'No matches': '无匹配结果',
  'Arguments': '参数',
  'Output': '输出',
  'No text output': '无文本输出',
  'Output truncated · /export downloads the complete log': '输出已截断 · /export 可下载完整日志',
  'Recent history only · /history loads more · /export downloads the complete log': '仅显示近期记录 · /history 加载更多 · /export 下载完整日志',
  'Some output is clipped in this view · /export downloads the complete log': '部分内容在此视图中已截断 · /export 下载完整日志',
  'Exporting…': '正在导出…',
  'Skills': '技能',
  '+{count} more · /help': '另有 {count} 个 · /help',
  '+{count} more · /skills': '另有 {count} 个 · /skills',
  'Choose a skill to start the message with': '选择技能作为消息开头',
  'No skills are available for this conversation': '当前对话没有可用的技能',
  'Continue: {title} · {age} · /resume': '继续：{title} · {age} · /resume',
  'Tool activity': '工具执行记录',
  'Show failed calls only': '只看失败调用',
  'Show all calls': '显示全部调用',
  'No tool activity': '暂无工具调用',
  'Commands': '命令',
  'Statistics': '统计',
  'Conversation': '对话',
  'Conversations': '历史对话',
  '+ New conversation': '+ 新建对话',
  'Current project': '当前项目',
  'All projects': '全部项目',
  'Untitled': '未命名',
  'Search conversation content': '搜索对话内容',
  'Search results': '搜索结果',
  'More matches exist; narrow the search.': '还有更多匹配结果，请缩小搜索范围。',
  'Rename conversation': '重命名对话',
  'Conversation renamed': '对话已重命名',
  'Fork from the latest completed turn?': '从最近一个已完成轮次分叉？',
  'Fork': '分叉',
  'Cancel': '取消',
  'Pending messages': '待执行消息',
  'No pending messages': '没有待执行消息',
  'Edit': '编辑',
  'Remove': '移除',
  'Steer now': '立即补充指令',
  'Edit pending message': '编辑待执行消息',
  'Message accepted for the next turn · /queue to manage': '消息已加入下一轮队列 · /queue 管理',
  'Instruction accepted for the next model step': '补充指令已接收，将用于下一次模型请求',
  'Sending…': '正在发送…',
  'Loading conversation…': '正在加载对话…',
  'Connected': '已连接',
  'Disconnected · /reconnect to retry': '连接已断开 · /reconnect 重试',
  'Reconnecting…': '正在重新连接…',
  'Language': '语言',
  'Layout': '布局',
  'Automatic': '自动',
  'Compact': '紧凑',
  'Detailed': '详细',
  'Browser sign-in link': '浏览器登录链接',
  'Open it in a browser to configure providers and credentials. Treat it like a password.': '在浏览器中打开以配置供应商和凭据。请像密码一样保管此链接。',
  'Allow {tool}?': '允许执行 {tool}？',
  'Reject': '拒绝',
  'Allow once': '允许一次',
  'Review operation': '查看操作详情',
  'Type an answer…': '输入回答…',
  'Done': '完成',
  'Export destination (.zip); existing files are not overwritten': '导出位置（.zip）；不会覆盖已有文件',
  'Saved to {path}': '已保存到 {path}',
  'Working…': '工作中…',
  'Waiting for model': '等待模型响应',
  'Receiving response': '正在接收回答',
  'Running tool': '正在执行工具',
  'Waiting for approval': '等待审批',
  'Waiting for answer': '等待回答',
  'Ctrl-C to stop': 'Ctrl-C 停止',
  '{count} tool calls': '{count} 次工具调用',
  '{count} failed': '{count} 次失败',
  'Indexing project files…': '正在索引项目文件…',
  'No matching project files': '没有匹配的项目文件',
  'Loading…': '正在加载…',
  'Unavailable': '未提供',
  'Model': '模型',
  'Reasoning': '推理强度',
  'Cache': '缓存命中',
  'Balance': '余额',
  'Input': '输入',
  'Cache read': '缓存读取',
  'Cache write': '缓存写入',
  'Uncached input': '未缓存输入',
  'Turns': '轮次',
  'Steps': '模型请求次数',
  'Average first token': '平均首 Token 等待',
  'Whole session · provider-reported token usage': '整个会话 · 供应商报告的 Token 用量',
  'Balance is the signed-in DeepSeek account; configure providers and credentials in Web.': '余额来自已登录的 DeepSeek 账户；请在 Web 配置供应商和凭据。',
  'Query failed · /stats to retry': '查询失败 · /stats 重试',
  'bonus': '赠送',
  'Start a conversation in this directory': '在当前目录新建对话',
  'Start a fresh conversation (same as /new)': '新建对话（同 /new）',
  'Find and resume a conversation': '查找并继续对话',
  'Choose the next model': '选择下一次请求的模型',
  'Choose reasoning effort': '选择推理强度',
  'Show complete usage and balance': '查看完整用量及余额',
  'Show complete usage and balance (same as /stats)': '查看完整用量及余额（同 /stats）',
  'Show the browser sign-in link': '显示浏览器登录链接',
  'Inspect tool arguments and output': '查看工具参数及输出',
  'Show commands and keyboard shortcuts': '查看命令及快捷键',
  'Close this terminal and its Web service': '退出终端并关闭其启动的 Web 服务',
  'Manage pending messages': '管理待执行消息',
  'Send an instruction at the next model step': '为下一次模型请求补充指令',
  'Fork from the latest completed turn': '从最近已完成轮次分叉',
  'Export the full Session ZIP': '导出完整会话 ZIP',
  'Load older history': '加载更早记录',
  'Choose interface language': '选择界面语言',
  'Choose status density': '选择状态栏密度',
  'Reconnect to the Harness': '重新连接 Harness',
  'Select model · applies to the next model request': '选择模型 · 从下一次请求生效',
  'This model does not offer selectable reasoning levels.': '此模型不支持选择推理强度。',
  'Reasoning · {model} · current: {effort}': '推理强度 · {model} · 当前：{effort}',
  'Enter send · Shift+Enter new line · ↑↓ edit/history': 'Enter 发送 · Shift+Enter 换行 · ↑↓ 编辑/历史',
  'Ctrl-N new · Ctrl-R resume · Ctrl-O tools · Ctrl-C stop (twice to exit) · Ctrl-Q exit': 'Ctrl-N 新建 · Ctrl-R 历史 · Ctrl-O 工具 · Ctrl-C 停止（按两次退出）· Ctrl-Q 退出',
  '@ inserts a project file path; the model can read it with its file tools.': '@ 插入项目文件路径；模型可通过文件工具读取它。',
  'Statistics need Session migration; send a message to resume.': '统计需要迁移会话；发送消息以继续。',
  'Statistics unavailable · /stats to retry': '统计不可用 · /stats 重试',
  'Live statistics disconnected · /reconnect to retry': '实时统计连接已断开 · /reconnect 重试',
} as const

/** Supported terminal interface languages. */
export type Language = 'en' | 'zh'
/** A terminal-owned phrase with a Chinese translation. */
export type Phrase = keyof typeof zh

/** Language selection owned by one terminal instance. */
export class TerminalLocale {
  /** @param language - English or Simplified Chinese. */
  constructor(public language: Language = 'en') {}

  /** Translate a command description supplied by the editor library.
   * @param label - command description.
   * @returns translated copy when the terminal owns the phrase. */
  description(label: string): string {
    return Object.hasOwn(zh, label) ? this.text(label as Phrase) : label
  }

  /**
   * Format one translated interface phrase.
   * @param phrase - English dictionary key.
   * @param values - named placeholders; omitted means no substitutions.
   * @returns localized interface text.
   */
  text(phrase: Phrase, values: Readonly<Record<string, string | number>> = {}): string {
    const template = this.language === 'zh' ? zh[phrase] : phrase
    return template.replace(/\{(\w+)\}/gu, (match: string, key: string) => String(values[key] ?? match))
  }
}
