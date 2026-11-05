import type { NoteContext, NoteSelectorService } from './note-selector.service.js';

export interface QuizQuestion {
  question: string;
  answer: string;
  source: string;
}

export interface QuizLlm {
  completeJson<T>(request: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    parse: (value: unknown) => T;
    inputChars?: number;
    temperature?: number;
  }): Promise<{ value: T }>;
  completeText(request: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    inputChars?: number;
    temperature?: number;
  }): Promise<{ value: string }>;
}

interface NoteScore {
  title: string;
  correct: number;
  total: number;
}

interface QuizSession {
  topic: string;
  questions: QuizQuestion[];
  index: number;
  score: number;
  perNote: Map<string, NoteScore>;
}

export interface QuizStart {
  intro: string;
  question: string;
  notes: string[];
}

export interface QuizFeedback {
  feedback: string;
  correct: boolean;
  finished: boolean;
  score: number;
  total: number;
  nextQuestion?: string;
  summary?: string;
}

const minimumQuestions = 3;
const maximumQuestions = 6;

export class QuizService {
  private readonly sessions = new Map<number, QuizSession>();

  constructor(
    private readonly selector: NoteSelectorService,
    private readonly llm: QuizLlm,
  ) {}

  hasSession(chatId: number): boolean {
    return this.sessions.has(chatId);
  }

  async start(chatId: number, expression: string): Promise<QuizStart> {
    const selection = await this.selector.select(expression);
    if (selection.mode === 'explicit' && selection.unresolved.length > 0) {
      throw new Error(
        `No encontré estas notas: ${selection.unresolved.join(', ')}. Usa el título exacto o la ruta .md.`,
      );
    }
    if (selection.notes.length === 0) {
      throw new Error(`No encontré notas sobre "${selection.query}" para armar el quiz.`);
    }

    const contexts = await this.selector.load(selection.notes);
    if (contexts.length === 0) {
      throw new Error(`No encontré notas sobre "${selection.query}" para armar el quiz.`);
    }

    const target = Math.max(minimumQuestions, Math.min(maximumQuestions, contexts.length));
    let questions = validateQuestions(await this.generate(expression, contexts, target), contexts);

    // Si el modelo se olvidó de alguna nota, un único reintento con la lista exacta.
    const missing = missingNotes(questions, contexts);
    if (missing.length > 0 && contexts.length > 1) {
      const extra = await this.generate(expression, contexts, missing.length, missing);
      questions = mergeQuestions(questions, validateQuestions(extra, contexts));
    }

    const finalQuestions = questions.slice(0, Math.max(target, contexts.length));
    const perNote = new Map<string, NoteScore>();
    for (const note of contexts) {
      perNote.set(normalizeTitle(note.title), {
        title: note.title,
        correct: 0,
        total: finalQuestions.filter((question) => normalizeTitle(question.source) === normalizeTitle(note.title)).length,
      });
    }

    const session: QuizSession = {
      topic: expression,
      questions: finalQuestions,
      index: 0,
      score: 0,
      perNote,
    };
    this.sessions.set(chatId, session);

    return {
      intro: `Quiz sobre "${selection.query}": ${session.questions.length} preguntas de ${contexts.length} nota(s). Responde con texto; /quiz stop para salir.`,
      question: session.questions[0]!.question,
      notes: contexts.map((note) => note.title),
    };
  }

  async answer(chatId: number, text: string): Promise<QuizFeedback | null> {
    const session = this.sessions.get(chatId);
    if (!session) return null;

    const current = session.questions[session.index]!;
    const evaluation = await this.llm.completeJson({
      messages: [
        {
          role: 'system',
          content: [
            'Evalúas respuestas de un quiz de estudio.',
            'Devuelve SOLO JSON válido: {"correct": true|false, "feedback": "explicación breve en español"}.',
            'Sé flexible con sinónimos y errores menores, pero exige que la idea central sea correcta.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Pregunta: ${current.question}\nRespuesta esperada: ${current.answer}\nRespuesta del estudiante: ${text}`,
        },
      ],
      parse: parseEvaluation,
      inputChars: text.length,
      temperature: 0,
    });

    const noteScore = session.perNote.get(normalizeTitle(current.source));
    if (evaluation.value.correct) {
      session.score += 1;
      if (noteScore) noteScore.correct += 1;
    }

    const total = session.questions.length;
    const isLast = session.index + 1 >= total;
    const feedback = [
      evaluation.value.correct ? '✅ Correcto.' : `❌ Incorrecto. Respuesta esperada: ${current.answer}`,
      evaluation.value.feedback,
      current.source ? `Fuente: [[${current.source}]]` : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (isLast) {
      this.sessions.delete(chatId);
      return {
        feedback,
        correct: evaluation.value.correct,
        finished: true,
        score: session.score,
        total,
        summary: buildSummary(session),
      };
    }

    session.index += 1;
    return {
      feedback,
      correct: evaluation.value.correct,
      finished: false,
      score: session.score,
      total,
      nextQuestion: session.questions[session.index]!.question,
    };
  }

  stop(chatId: number): boolean {
    return this.sessions.delete(chatId);
  }

  private async generate(
    expression: string,
    notes: NoteContext[],
    count: number,
    missing: NoteContext[] = [],
  ): Promise<QuizQuestion[]> {
    const generated = await this.llm.completeJson({
      messages: [
        {
          role: 'system',
          content: [
            'Generas quizzes de estudio a partir de notas personales.',
            'Devuelve SOLO JSON válido con la forma:',
            '{"questions":[{"question":"...","answer":"...","source":"Título exacto de la nota"}]}',
            `Genera exactamente ${count} preguntas abiertas, claras y respondibles con el contexto.`,
            'Reparte las preguntas entre las notas: al menos una por nota cuando el número de preguntas lo permita.',
            'Si hay varias notas, incluye al menos una pregunta que relacione ideas de notas distintas.',
            'El campo source debe ser EXACTAMENTE uno de los títulos listados (sin [[ ]] ni ruta).',
            'No incluyas la respuesta dentro de la pregunta ni inventes contenido ausente.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Tema: ${expression}`,
            '',
            ...notes.map(
              (note, index) => `### NOTA ${index + 1}: [[${note.title}]] (${note.relativePath})\n${note.content}`,
            ),
            missing.length > 0
              ? `\nFaltan preguntas para estas notas: ${missing.map((note) => `[[${note.title}]]`).join(', ')}. Añade una por cada una, sin repetir las existentes.`
              : '',
          ].join('\n'),
        },
      ],
      parse: parseQuestions,
      inputChars: notes.reduce((total, note) => total + note.content.length, 0),
      temperature: 0.5,
    });
    return generated.value;
  }
}

function parseQuestions(value: unknown): QuizQuestion[] {
  const record = (typeof value === 'string' ? JSON.parse(value) : value) as { questions?: unknown };
  if (!Array.isArray(record?.questions)) throw new Error('El quiz no tiene preguntas.');
  const questions = record.questions
    .map((item) => {
      const entry = item as { question?: unknown; answer?: unknown; source?: unknown };
      return {
        question: typeof entry.question === 'string' ? entry.question.trim() : '',
        answer: typeof entry.answer === 'string' ? entry.answer.trim() : '',
        source: typeof entry.source === 'string' ? entry.source.trim() : '',
      };
    })
    .filter((item) => item.question && item.answer)
    .slice(0, 12);
  if (questions.length < 1) throw new Error('El quiz no contiene preguntas válidas.');
  return questions;
}

function validateQuestions(parsed: QuizQuestion[], notes: NoteContext[]): QuizQuestion[] {
  const titles = new Map(notes.map((note) => [normalizeTitle(note.title), note.title]));
  const byPath = new Map(notes.map((note) => [normalizeTitle(note.relativePath), note.title]));
  const seen = new Set<string>();
  const valid: QuizQuestion[] = [];

  for (const question of parsed) {
    let source = titles.get(normalizeTitle(question.source)) ?? byPath.get(normalizeTitle(question.source));
    if (!source && notes.length === 1) source = notes[0]!.title;
    // Sin fuente válida en un quiz multi-nota, se descarta: no se inventa la atribución.
    if (!source) continue;
    const key = normalizeTitle(question.question);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ ...question, source });
  }

  if (valid.length === 0) {
    throw new Error('El LLM no devolvió preguntas con una fuente válida.');
  }
  return valid;
}

function missingNotes(questions: QuizQuestion[], notes: NoteContext[]): NoteContext[] {
  const used = new Set(questions.map((question) => normalizeTitle(question.source)));
  return notes.filter((note) => !used.has(normalizeTitle(note.title)));
}

function mergeQuestions(first: QuizQuestion[], extra: QuizQuestion[]): QuizQuestion[] {
  const seen = new Set(first.map((question) => normalizeTitle(question.question)));
  return [
    ...first,
    ...extra.filter((question) => {
      const key = normalizeTitle(question.question);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

function buildSummary(session: QuizSession): string {
  const total = session.questions.length;
  const lines = [
    `Quiz terminado: ${session.score}/${total} correctas sobre "${session.topic}".`,
  ];
  if (session.perNote.size > 1) {
    lines.push('', 'Por nota:');
    for (const note of session.perNote.values()) {
      lines.push(`- [[${note.title}]]: ${note.correct}/${note.total}`);
    }
  }
  return lines.join('\n');
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\[\[|\]\]/g, '')
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseEvaluation(value: unknown): { correct: boolean; feedback: string } {
  const record = (typeof value === 'string' ? JSON.parse(value) : value) as {
    correct?: unknown;
    feedback?: unknown;
  };
  return {
    correct: record?.correct === true,
    feedback: typeof record?.feedback === 'string' ? record.feedback : '',
  };
}
