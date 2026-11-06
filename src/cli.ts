import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRuntime } from './bootstrap.js';
import { loadEnv } from './config/env.js';
import { formatNoteList } from './lib/note-list.js';

const usage = `Idearium CLI

Uso:
  npm run cli -- text "una idea" [--remote]
  npm run cli -- audio ./ruta/audio.ogg [--remote]
  npm run cli -- query "¿qué anoté sobre X?"
  npm run cli -- notes [texto]
  npm run cli -- reindex

Opciones:
  --remote   fuerza OpenRouter (falla si no hay OPENROUTER_API_KEY)
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      remote: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(usage);
    return;
  }

  const env = loadEnv();
  const runtime = await createRuntime(env);
  const input = rest.join(' ').trim();

  try {
    switch (command) {
      case 'text': {
        if (!input) throw new Error('Falta el texto. Ejemplo: npm run cli -- text "mi idea"');
        const result = await runtime.ingest.ingestText(input, { source: 'cli_text', remote: values.remote });
        printIngest(result);
        break;
      }
      case 'audio': {
        const file = rest[0];
        if (!file) throw new Error('Falta la ruta del audio.');
        const absolute = path.resolve(file);
        await readFile(absolute);
        const result = await runtime.ingest.ingestAudio(absolute, {
          source: 'cli_audio',
          remote: values.remote,
          audioFile: absolute,
        });
        printIngest(result);
        break;
      }
      case 'query': {
        if (!input) throw new Error('Falta la pregunta.');
        const answer = await runtime.rag.query(input);
        console.log(answer.answer);
        if (answer.sources.length > 0) {
          console.log('\nFuentes:');
          for (const source of answer.sources) {
            console.log(`- [[${source.title}]] (${source.path})`);
          }
        }
        break;
      }
      case 'notes': {
        const notes = await runtime.memorize.listNotes();
        const filtered = input
          ? notes.filter((note) =>
              `${note.title} ${note.relativePath}`.toLowerCase().includes(input.toLowerCase()),
            )
          : notes;
        console.log(formatNoteList(filtered));
        break;
      }
      case 'reindex': {
        const result = await runtime.indexer.reindexAll();
        console.log(
          `Indexadas: ${result.indexed} · sin cambios: ${result.skipped} · eliminadas: ${result.removed} · fallidas: ${result.failed}`,
        );
        break;
      }
      default:
        console.log(usage);
        throw new Error(`Comando desconocido: ${command}`);
    }
  } finally {
    await runtime.close();
  }
}

function printIngest(result: Awaited<ReturnType<Awaited<ReturnType<typeof createRuntime>>['ingest']['ingestText']>>): void {
  console.log(`Nota: ${result.note.path}`);
  console.log(`Título: ${result.note.title}`);
  console.log(`Tags: ${result.note.tags.join(', ')}`);
  console.log(`Modelo: ${result.provider}/${result.model} (${result.usedRemote ? 'remoto' : 'local'})`);
  console.log(`Indexada: ${result.indexed ? 'sí' : `no${result.indexingError ? ` (${result.indexingError})` : ''}`}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
