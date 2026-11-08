import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NoteSelectorService } from '../src/services/note-selector.service.js';
import { QuizService, type QuizLlm } from '../src/services/quiz.service.js';
import type { Embedder } from '../src/services/embedding.service.js';
import type { VectorStore } from '../src/services/vector.service.js';

const dirs: string[] = [];

const emptyVector = {
  search: async () => [],
  upsertNote: async () => undefined,
  deleteByPath: async () => undefined,
  count: async () => 0,
  clear: async () => undefined,
} as VectorStore;

const emptyEmbedder = { embed: async (texts: string[]) => texts.map(() => [1, 0, 0, 0]) } as unknown as Embedder;

async function notesVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'idearium-quiz-'));
  dirs.push(dir);
  for (const title of ['Alfa', 'Beta', 'Gamma']) {
    await writeFile(
      path.join(dir, `${title.toLowerCase()}.md`),
      `---\ntitle: ${title}\ntags: [quiz]\ncategory: idea\n---\n\n# ${title}\n\nContenido de ${title}.\n`,
      'utf8',
    );
  }
  return dir;
}

function selector(vaultPath: string): NoteSelectorService {
  return new NoteSelectorService({ vaultPath }, emptyVector, emptyEmbedder);
}

function fakeLlm(responses: unknown[]): { llm: QuizLlm; calls: any[] } {
  const calls: any[] = [];
  const llm = {
    completeJson: async (request: any) => {
      calls.push(request);
      const next = responses.shift();
      if (next === undefined) throw new Error('respuesta LLM agotada');
      return { value: request.parse(next) };
    },
    completeText: async () => ({ value: '' }),
  } as QuizLlm;
  return { llm, calls };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('QuizService multi-nota', () => {
  it('reparte preguntas, reintenta las notas que faltan y rechaza fuentes inventadas', async () => {
    const dir = await notesVault();
    const { llm, calls } = fakeLlm([
      {
        questions: [
          { question: '¿Qué es Alfa?', answer: 'Contenido de Alfa', source: 'Alfa' },
          { question: '¿Qué es Beta?', answer: 'Contenido de Beta', source: '[[Beta]]' },
          { question: '¿Qué inventa?', answer: 'Nada', source: 'Fantasma' },
        ],
      },
      {
        questions: [{ question: '¿Qué es Gamma?', answer: 'Contenido de Gamma', source: 'Gamma' }],
      },
      { correct: true, feedback: 'Bien' },
      { correct: true, feedback: 'Bien' },
      { correct: true, feedback: 'Bien' },
    ]);

    const quiz = new QuizService(selector(dir), llm);
    const started = await quiz.start(1, 'notas Alfa, Beta y Gamma');

    expect(started.notes).toEqual(['Alfa', 'Beta', 'Gamma']);
    expect(started.intro).toContain('3 preguntas de 3 nota(s)');
    expect(calls[0].messages[1].content).toContain('### NOTA 3: [[Gamma]]');
    expect(calls[1].messages[1].content).toContain('Faltan preguntas para estas notas: [[Gamma]]');

    const first = await quiz.answer(1, 'Alfa');
    expect(first?.feedback).toContain('Fuente: [[Alfa]]');
    await quiz.answer(1, 'Beta');
    const last = await quiz.answer(1, 'Gamma');

    expect(last?.finished).toBe(true);
    expect(last?.summary).toContain('- [[Alfa]]: 1/1');
    expect(last?.summary).toContain('- [[Beta]]: 1/1');
    expect(last?.summary).toContain('- [[Gamma]]: 1/1');
    expect(quiz.hasSession(1)).toBe(false);
  });

  it('devuelve las preguntas falladas con su fuente y etiquetas al terminar', async () => {
    const dir = await notesVault();
    const { llm } = fakeLlm([
      {
        questions: [
          { question: '¿Qué contiene Alfa?', answer: 'Contenido de Alfa', source: 'Alfa' },
          { question: 'Otra de Alfa', answer: 'Contenido de Alfa', source: 'Alfa' },
          { question: 'Tercera de Alfa', answer: 'Contenido de Alfa', source: 'Alfa' },
        ],
      },
      { correct: false, feedback: 'Falta un detalle' },
      { correct: true, feedback: 'Bien' },
      { correct: true, feedback: 'Bien' },
    ]);

    const quiz = new QuizService(selector(dir), llm);
    await quiz.start(9, 'alfa');
    await quiz.answer(9, 'no sé');
    await quiz.answer(9, 'bien');
    const last = await quiz.answer(9, 'bien');

    expect(last?.failed).toHaveLength(1);
    expect(last?.failed?.[0]).toMatchObject({
      question: '¿Qué contiene Alfa?',
      answer: 'Contenido de Alfa',
      source: 'Alfa',
      sourceNote: 'alfa.md',
    });
    expect(last?.failed?.[0]?.tags).toEqual(expect.arrayContaining(['quiz', 'idea']));
  });

  it('funciona con una sola nota y no exige varios remitentes', async () => {
    const dir = await notesVault();
    const { llm } = fakeLlm([
      {
        questions: [
          { question: '¿Qué contiene Alfa?', answer: 'Contenido de Alfa', source: '' },
          { question: 'Otra de Alfa', answer: 'Contenido de Alfa', source: '' },
          { question: 'Tercera de Alfa', answer: 'Contenido de Alfa', source: '' },
        ],
      },
      { correct: false, feedback: 'Casi' },
    ]);

    const quiz = new QuizService(selector(dir), llm);
    const started = await quiz.start(7, 'alfa');

    expect(started.notes).toEqual(['Alfa']);
    const feedback = await quiz.answer(7, 'no sé');
    expect(feedback?.feedback).toContain('Fuente: [[Alfa]]');
    expect(feedback?.finished).toBe(false);
    quiz.stop(7);
  });

  it('no devuelve fallos cuando todas las respuestas son correctas', async () => {
    const dir = await notesVault();
    const { llm } = fakeLlm([
      {
        questions: [
          { question: '¿Qué contiene Alfa?', answer: 'Contenido de Alfa', source: 'Alfa' },
          { question: 'Otra de Alfa', answer: 'Contenido de Alfa', source: 'Alfa' },
          { question: 'Tercera de Alfa', answer: 'Contenido de Alfa', source: 'Alfa' },
        ],
      },
      { correct: true, feedback: 'Bien' },
      { correct: true, feedback: 'Bien' },
      { correct: true, feedback: 'Bien' },
    ]);

    const quiz = new QuizService(selector(dir), llm);
    await quiz.start(11, 'alfa');
    await quiz.answer(11, 'bien');
    await quiz.answer(11, 'bien');
    const last = await quiz.answer(11, 'bien');

    expect(last?.failed).toEqual([]);
  });

  it('falla si no hay notas para el tema', async () => {
    const dir = await notesVault();
    const { llm } = fakeLlm([]);
    const quiz = new QuizService(selector(dir), llm);

    await expect(quiz.start(1, 'tema inexistente')).rejects.toThrow('No encontré notas');
  });
});
