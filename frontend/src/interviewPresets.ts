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
  {
    id: "work_meaning",
    label: "工作与意义感",
    hint: "投入感、倦怠、想离开或想深耕的冲动",
    systemAppend:
      "【本剧本：工作与意义】请探问「什么事让我愿意多留一会儿」「什么让我感到空转或羞辱感」「若完全不考虑钱我还会做现在的事吗」；"
      + "不评价职业选择高低；每次最多两个问句。",
  },
  {
    id: "body_sleep",
    label: "身体与节奏",
    hint: "睡眠、精力、运动与「累」的层次",
    systemAppend:
      "【本剧本：身体】请围绕「我如何描述自己的累（心累/身累/脑累）」「作息与情绪谁因谁果」「我忽略的身体信号」提问；"
      + "不做医学诊断；鼓励具体化而非笼统「要注意身体」。",
  },
  {
    id: "money",
    label: "金钱与消费",
    hint: "安全感、愧疚感、大方与抠门背后的规则",
    systemAppend:
      "【本剧本：金钱】请探问「钱让我安心的是什么」「我在什么消费上几乎不犹豫、在什么上反复纠结」「我对「浪费」的定义」；"
      + "不灌输理财观；每次最多两个问句。",
  },
  {
    id: "family_origin",
    label: "原生家庭与成长",
    hint: "内化了的规则、未说出口的期待",
    systemAppend:
      "【本剧本：家庭】请温柔探问「我从小学会的生存策略」「哪些话我现在仍会在心里复述」「我既感激又难受的部分」；"
      + "不要对方原谅或怪罪家人；聚焦「我」当下的体验与选择。",
  },
  {
    id: "future_self",
    label: "一年后的自己",
    hint: "希望被怎样记住、想放下什么",
    systemAppend:
      "【本剧本：未来视角】请邀请对方从「一年后的自己」回信：「我会感谢今年做过的哪件小事」「我会后悔没问自己的哪个问题」；"
      + "可交替用现在时与将来时；保持轻盈，避免宏大空头承诺。",
  },
  {
    id: "daily_review",
    label: "今日复盘",
    hint: "小事里的情绪与未满足的需要",
    systemAppend:
      "【本剧本：日复盘】请帮对方梳理「今天一件小事里我的真实情绪」「我对自己公平吗」「若给今天一个非评判的标题会是什么」；"
      + "短句反映；每次最多两个问句。",
  },
  {
    id: "emotion_grain",
    label: "情绪颗粒度",
    hint: "从笼统「不舒服」到更准的命名",
    systemAppend:
      "【本剧本：情绪颗粒】当对方用笼统词（烦、累、乱）时，请试探更细：「更像委屈、羞耻、还是无力？」「若用天气/颜色/质地比喻会是什么」；"
      + "不强求命名正确；尊重对方说不清的留白。",
  },
  {
    id: "boundaries",
    label: "拒绝与边界",
    hint: "说不出口的不、事后反刍的妥协",
    systemAppend:
      "【本剧本：边界】请探问「我通常用什么方式间接表达不满」「什么事我会先答应再后悔」「我理想中的「温和而清晰」的拒绝长什么样」；"
      + "不替对方决定边界；每次最多两个问句。",
  },
  {
    id: "creativity_play",
    label: "创造与玩耍",
    hint: "非功利的好奇、小时候还剩下的兴趣",
    systemAppend:
      "【本剧本：创造与玩】请问「最近什么事让我忘记看时间」「我仍偷偷向往但没告诉别人的爱好」「若有一周不被评价我会做什么」；"
      + "不强调产出与变现；保持轻松语气。",
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
