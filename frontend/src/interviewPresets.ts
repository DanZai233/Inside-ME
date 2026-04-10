/** 深度访谈模式下附加到系统提示的剧本（与「人设/系统补充」合并发送）。 */

export type InterviewPreset = {
  id: string;
  label: string;
  hint: string;
  /** 追加在通用访谈指令之后 */
  systemAppend: string;
};

export const INTERVIEW_PRESETS: InterviewPreset[] = [
  {
    id: "",
    label: "无剧本",
    hint: "仅使用下方「人设/系统补充」与默认访谈节奏",
    systemAppend: "",
  },
  {
    id: "values",
    label: "价值观与取舍",
    hint: "澄清重视什么、愿意放弃什么、矛盾时的选择逻辑",
    systemAppend:
      "【本剧本：价值观】请围绕「什么对我真正重要」「我在冲突选项里如何选」「我后悔过哪些取舍」提问与反映；"
      + "每次最多两个问句；不做道德评判；不替代心理咨询。",
  },
  {
    id: "fear_desire",
    label: "恐惧与渴望",
    hint: "靠近担心的事与向往的生活",
    systemAppend:
      "【本剧本：恐惧与渴望】请温柔探问「我害怕发生什么」「我渴望被怎样看见」「什么让我既想要又退缩」；"
      + "反映情绪用词而非诊断；每次最多两个问句。",
  },
  {
    id: "relationship",
    label: "关系与边界",
    hint: "重要他人、期待、委屈与边界",
    systemAppend:
      "【本剧本：关系】请围绕「我在关系里常扮演的角色」「难以说出口的期待」「边界被踩时的反应」展开；"
      + "不揣测第三方动机；聚焦「我」的体验与选择。",
  },
  {
    id: "narrative",
    label: "自我叙事",
    hint: "我如何讲自己的故事、是否单一标签化自己",
    systemAppend:
      "【本剧本：叙事】请帮助对方看见「我给自己贴的主标签」「我忽略的矛盾面向」「若换一个说法描述同一段经历会怎样」；"
      + "保持好奇与实验感，少下结论。",
  },
];

export function getInterviewPreset(id: string): InterviewPreset | undefined {
  return INTERVIEW_PRESETS.find((p) => p.id === id);
}

export function mergeInterviewExtra(presetAppend: string, userExtra: string): string | null {
  const a = presetAppend.trim();
  const b = userExtra.trim();
  if (a && b) return `${a}\n\n${b}`;
  if (a) return a;
  if (b) return b;
  return null;
}
