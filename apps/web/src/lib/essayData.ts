export interface EssaySentence {
  unitId: string;
  sentenceIndex: number;
  text: string;
}

export interface Essay {
  essayIndex: number;
  sentences: EssaySentence[];
}

export const ESSAYS: Essay[] = [
  {
    essayIndex: 1,
    sentences: [
      {
        unitId: "essay0001_sentence01",
        sentenceIndex: 1,
        text: "AI literacy refers to the set of competencies that enable individuals to critically evaluate, effectively communicate with, and responsibly use artificial intelligence technologies."
      },
      {
        unitId: "essay0001_sentence02",
        sentenceIndex: 2,
        text: "Research shows that people with higher AI literacy tend to make better-informed decisions when interacting with AI-powered systems."
      },
      {
        unitId: "essay0001_sentence03",
        sentenceIndex: 3,
        text: "Educational institutions should integrate AI literacy into their core curriculum starting from middle school."
      },
      {
        unitId: "essay0001_sentence04",
        sentenceIndex: 4,
        text: "Teachers can leverage AI-powered tools to create personalized learning experiences and adaptive assessments for their students."
      },
      {
        unitId: "essay0001_sentence05",
        sentenceIndex: 5,
        text: "As AI continues to advance, the gap between AI-literate and AI-illiterate populations may create new forms of digital inequality."
      }
    ]
  },
  {
    essayIndex: 2,
    sentences: [
      {
        unitId: "essay0002_sentence01",
        sentenceIndex: 1,
        text: "Machine learning algorithms work by identifying patterns in large datasets and using those patterns to make predictions or decisions."
      },
      {
        unitId: "essay0002_sentence02",
        sentenceIndex: 2,
        text: "While AI chatbots can handle routine customer inquiries efficiently, they often struggle with nuanced or emotionally sensitive conversations."
      },
      {
        unitId: "essay0002_sentence03",
        sentenceIndex: 3,
        text: "Companies must ensure transparency in how they use AI systems to make hiring and promotion decisions."
      },
      {
        unitId: "essay0002_sentence04",
        sentenceIndex: 4,
        text: "Healthcare professionals are using AI-assisted diagnostic tools to detect diseases earlier and improve patient outcomes."
      },
      {
        unitId: "essay0002_sentence05",
        sentenceIndex: 5,
        text: "The widespread adoption of AI in creative industries may fundamentally reshape how we define authorship and intellectual property."
      }
    ]
  },
  {
    essayIndex: 3,
    sentences: [
      {
        unitId: "essay0003_sentence01",
        sentenceIndex: 1,
        text: "Bias in AI systems occurs when training data reflects historical prejudices, leading to unfair or discriminatory outputs."
      },
      {
        unitId: "essay0003_sentence02",
        sentenceIndex: 2,
        text: "Current AI language models can generate highly convincing text, but they lack genuine understanding of meaning and context."
      },
      {
        unitId: "essay0003_sentence03",
        sentenceIndex: 3,
        text: "Developers have an ethical obligation to test their AI systems for bias and to implement safeguards against misuse."
      },
      {
        unitId: "essay0003_sentence04",
        sentenceIndex: 4,
        text: "Citizens can use fact-checking AI tools to verify the accuracy of news articles and social media posts before sharing them."
      },
      {
        unitId: "essay0003_sentence05",
        sentenceIndex: 5,
        text: "Without proper governance frameworks, the rapid deployment of AI could undermine democratic processes and concentrate power in the hands of a few technology companies."
      }
    ]
  }
];

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
