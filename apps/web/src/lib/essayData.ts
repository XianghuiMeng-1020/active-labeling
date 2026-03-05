export interface EssaySentence {
  unitId: string;
  sentenceIndex: number;
  text: string;
  text_zhHans: string;
  text_zhHant: string;
}

export interface Essay {
  essayIndex: number;
  sentences: EssaySentence[];
}

/**
 * 15 sentences across 3 essays, balanced for 6 labels:
 *   CODE (2-3), EXPLANATION (2-3), EVALUATION (2-3),
 *   RESPONSIBILITY (2-3), APPLICATION (2-3), IMPLICATION (2-3)
 *
 * Essay 1: CODE, EXPLANATION, APPLICATION, EVALUATION, IMPLICATION
 * Essay 2: CODE, EXPLANATION, EVALUATION, RESPONSIBILITY, APPLICATION
 * Essay 3: RESPONSIBILITY, EVALUATION, CODE, APPLICATION, IMPLICATION
 */
export const ESSAYS: Essay[] = [
  {
    essayIndex: 1,
    sentences: [
      {
        unitId: "essay0001_sentence01",
        sentenceIndex: 1,
        text: "AI literacy refers to the set of competencies that enable individuals to critically evaluate, effectively communicate with, and responsibly use artificial intelligence technologies.",
        text_zhHans: "AI素养是指使个人能够批判性地评估、有效地与人工智能技术沟通并负责任地使用人工智能技术的一系列能力。",
        text_zhHant: "AI素養是指使個人能夠批判性地評估、有效地與人工智慧技術溝通並負責任地使用人工智慧技術的一系列能力。"
      },
      {
        unitId: "essay0001_sentence02",
        sentenceIndex: 2,
        text: "Machine learning algorithms work by identifying patterns in large datasets and using those patterns to make predictions or decisions.",
        text_zhHans: "机器学习算法通过识别大型数据集中的模式，并利用这些模式进行预测或决策。",
        text_zhHant: "機器學習演算法透過識別大型資料集中的模式，並利用這些模式進行預測或決策。"
      },
      {
        unitId: "essay0001_sentence03",
        sentenceIndex: 3,
        text: "Teachers can leverage AI-powered tools to create personalized learning experiences and adaptive assessments for their students.",
        text_zhHans: "教师可以利用AI驱动的工具为学生创建个性化的学习体验和自适应评估。",
        text_zhHant: "教師可以利用AI驅動的工具為學生創建個性化的學習體驗和自適應評估。"
      },
      {
        unitId: "essay0001_sentence04",
        sentenceIndex: 4,
        text: "While AI chatbots can handle routine customer inquiries efficiently, they often struggle with nuanced or emotionally sensitive conversations.",
        text_zhHans: "虽然AI聊天机器人可以高效处理日常客户咨询，但它们在处理细微或情感敏感的对话时往往力不从心。",
        text_zhHant: "雖然AI聊天機器人可以高效處理日常客戶諮詢，但它們在處理細微或情感敏感的對話時往往力不從心。"
      },
      {
        unitId: "essay0001_sentence05",
        sentenceIndex: 5,
        text: "As AI continues to advance, the gap between AI-literate and AI-illiterate populations may create new forms of digital inequality.",
        text_zhHans: "随着AI持续发展，具备AI素养和缺乏AI素养的群体之间的差距可能会造成新的数字不平等。",
        text_zhHant: "隨著AI持續發展，具備AI素養和缺乏AI素養的群體之間的差距可能會造成新的數位不平等。"
      }
    ]
  },
  {
    essayIndex: 2,
    sentences: [
      {
        unitId: "essay0002_sentence01",
        sentenceIndex: 1,
        text: "Natural language processing is a branch of AI that deals with the interaction between computers and human language.",
        text_zhHans: "自然语言处理是人工智能的一个分支，专门研究计算机与人类语言之间的交互。",
        text_zhHant: "自然語言處理是人工智慧的一個分支，專門研究電腦與人類語言之間的交互。"
      },
      {
        unitId: "essay0002_sentence02",
        sentenceIndex: 2,
        text: "Research shows that people with higher AI literacy tend to make better-informed decisions when interacting with AI-powered systems.",
        text_zhHans: "研究表明，具有较高AI素养的人在与AI驱动的系统交互时往往能做出更明智的决策。",
        text_zhHant: "研究表明，具有較高AI素養的人在與AI驅動的系統交互時往往能做出更明智的決策。"
      },
      {
        unitId: "essay0002_sentence03",
        sentenceIndex: 3,
        text: "Current AI language models can generate highly convincing text, but they lack genuine understanding of meaning and context.",
        text_zhHans: "当前的AI语言模型可以生成高度令人信服的文本，但它们缺乏对含义和上下文的真正理解。",
        text_zhHant: "當前的AI語言模型可以生成高度令人信服的文本，但它們缺乏對含義和上下文的真正理解。"
      },
      {
        unitId: "essay0002_sentence04",
        sentenceIndex: 4,
        text: "Companies must ensure transparency in how they use AI systems to make hiring and promotion decisions.",
        text_zhHans: "公司必须确保其使用AI系统进行招聘和晋升决策时的透明度。",
        text_zhHant: "公司必須確保其使用AI系統進行招聘和晉升決策時的透明度。"
      },
      {
        unitId: "essay0002_sentence05",
        sentenceIndex: 5,
        text: "Healthcare professionals are using AI-assisted diagnostic tools to detect diseases earlier and improve patient outcomes.",
        text_zhHans: "医疗专业人员正在使用AI辅助诊断工具来更早地发现疾病并改善患者的治疗效果。",
        text_zhHant: "醫療專業人員正在使用AI輔助診斷工具來更早地發現疾病並改善患者的治療效果。"
      }
    ]
  },
  {
    essayIndex: 3,
    sentences: [
      {
        unitId: "essay0003_sentence01",
        sentenceIndex: 1,
        text: "Developers have an ethical obligation to test their AI systems for bias and to implement safeguards against misuse.",
        text_zhHans: "开发者有道德义务测试其AI系统是否存在偏见，并实施防止滥用的保障措施。",
        text_zhHant: "開發者有道德義務測試其AI系統是否存在偏見，並實施防止濫用的保障措施。"
      },
      {
        unitId: "essay0003_sentence02",
        sentenceIndex: 2,
        text: "Bias in AI systems occurs when training data reflects historical prejudices, leading to unfair or discriminatory outputs.",
        text_zhHans: "当训练数据反映历史偏见时，AI系统中就会出现偏差，导致不公平或歧视性的输出。",
        text_zhHant: "當訓練資料反映歷史偏見時，AI系統中就會出現偏差，導致不公平或歧視性的輸出。"
      },
      {
        unitId: "essay0003_sentence03",
        sentenceIndex: 3,
        text: "A neural network is a computing system inspired by the biological neural networks that constitute the human brain.",
        text_zhHans: "神经网络是一种受构成人脑的生物神经网络启发的计算系统。",
        text_zhHant: "神經網路是一種受構成人腦的生物神經網路啟發的計算系統。"
      },
      {
        unitId: "essay0003_sentence04",
        sentenceIndex: 4,
        text: "Citizens can use fact-checking AI tools to verify the accuracy of news articles and social media posts before sharing them.",
        text_zhHans: "公民可以使用AI事实核查工具在分享新闻文章和社交媒体帖子之前验证其准确性。",
        text_zhHant: "公民可以使用AI事實核查工具在分享新聞文章和社交媒體帖子之前驗證其準確性。"
      },
      {
        unitId: "essay0003_sentence05",
        sentenceIndex: 5,
        text: "Without proper governance frameworks, the rapid deployment of AI could undermine democratic processes and concentrate power in the hands of a few technology companies.",
        text_zhHans: "如果没有适当的治理框架，AI的快速部署可能会破坏民主进程，并将权力集中在少数科技公司手中。",
        text_zhHant: "如果沒有適當的治理框架，AI的快速部署可能會破壞民主進程，並將權力集中在少數科技公司手中。"
      }
    ]
  }
];

export type EssayLocale = "zh-Hans" | "zh-Hant" | "en";

export function getSentenceText(s: EssaySentence, locale: EssayLocale): string {
  if (locale === "zh-Hans") return s.text_zhHans;
  if (locale === "zh-Hant") return s.text_zhHant;
  return s.text;
}

export function getEssayByUnitId(unitId: string): Essay | null {
  for (const essay of ESSAYS) {
    if (essay.sentences.some((s) => s.unitId === unitId)) return essay;
  }
  return null;
}

export function getSentenceIndex(unitId: string): number | null {
  for (const essay of ESSAYS) {
    const s = essay.sentences.find((s) => s.unitId === unitId);
    if (s) return s.sentenceIndex;
  }
  return null;
}
