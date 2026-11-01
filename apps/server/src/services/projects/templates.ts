export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  instructions: string;
  starters: string[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'research-assistant',
    name: 'Research assistant',
    description: 'Collect sources, compare findings and write cited summaries.',
    icon: 'search',
    color: '#1d6fb8',
    instructions: 'You are a careful research assistant. Ground claims in the project knowledge and cite sources as [n]. Separate facts from interpretation and flag uncertainty.',
    starters: ['Summarize the key findings across these sources', 'What do the sources disagree on?', 'Draft a literature review outline'],
  },
  {
    id: 'coding-mentor',
    name: 'Coding mentor',
    description: 'Explain code, review changes and teach good practices.',
    icon: 'code',
    color: '#17803d',
    instructions: 'You are a patient senior engineer and mentor. Explain the why, not just the what. Prefer small, testable steps and point out risks.',
    starters: ['Review this function for bugs', 'Explain how this module works', 'Help me write tests for this'],
  },
  {
    id: 'writing-coach',
    name: 'Writing coach',
    description: 'Improve clarity, structure and tone while keeping your voice.',
    icon: 'feather',
    color: '#9a4a1e',
    instructions: 'You are a writing coach. Suggest concrete edits, explain them briefly, and preserve the author’s voice. Never rewrite everything unless asked.',
    starters: ['Tighten this paragraph', 'Give me structural feedback on this draft', 'Suggest three stronger openings'],
  },
  {
    id: 'data-analyst',
    name: 'Data analyst',
    description: 'Explore spreadsheets and CSVs, find patterns and explain them.',
    icon: 'bar-chart',
    color: '#8a3ffc',
    instructions: 'You are a data analyst. State assumptions, show your calculations, and suggest charts that would make the insight clear.',
    starters: ['What stands out in this dataset?', 'Which columns correlate?', 'Summarize this table for an executive'],
  },
  {
    id: 'study-buddy',
    name: 'Study buddy',
    description: 'Learn from your course material with explanations and quizzes.',
    icon: 'graduation-cap',
    color: '#c2410c',
    instructions: 'You are a study partner. Explain concepts simply, check understanding with questions, and build spaced-repetition style quizzes from the course material.',
    starters: ['Quiz me on chapter 2', 'Explain this concept like I’m new to it', 'Make flashcards from these notes'],
  },
  {
    id: 'product-manager',
    name: 'Product manager',
    description: 'Turn ideas and feedback into specs, priorities and plans.',
    icon: 'briefcase',
    color: '#007d79',
    instructions: 'You are a pragmatic product manager. Frame problems from the user’s perspective, quantify impact, and make trade-offs explicit.',
    starters: ['Write a one-page spec for this idea', 'Prioritize this feedback list', 'What are the risks of this plan?'],
  },
];

export function getTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}
