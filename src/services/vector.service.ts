import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Field, FixedSizeList, Float32, Int32, Schema, Utf8 } from 'apache-arrow';
import { connect, type Connection, type Table } from '@lancedb/lancedb';
import { logger, type Logger } from '../lib/logger.js';

export const notesTableName = 'notes';

export interface VectorRow {
  id: string;
  note_path: string;
  chunk_index: number;
  vector: number[];
  text: string;
  title: string;
  tags: string;
  category: string;
  updated_at: string;
}

export interface SearchHit {
  id: string;
  notePath: string;
  chunkIndex: number;
  title: string;
  tags: string[];
  category: string;
  text: string;
  updatedAt: string;
  distance: number;
}

export interface VectorStore {
  search(vector: number[], limit: number): Promise<SearchHit[]>;
  upsertNote(notePath: string, rows: VectorRow[]): Promise<void>;
  deleteByPath(notePath: string): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export class VectorService implements VectorStore {
  private db?: Connection;
  private table?: Table;

  constructor(
    private readonly dbPath: string,
    private readonly dimension: number,
    private readonly log: Logger = logger,
  ) {}

  async open(): Promise<void> {
    if (this.table) return;
    const absolute = path.resolve(this.dbPath);
    await mkdir(absolute, { recursive: true });
    this.db = await connect(absolute);
    const names = await this.db.tableNames();

    if (names.includes(notesTableName)) {
      this.table = await this.db.openTable(notesTableName);
      return;
    }

    const schema = new Schema([
      new Field('id', new Utf8(), true),
      new Field('note_path', new Utf8(), true),
      new Field('chunk_index', new Int32(), true),
      new Field(
        'vector',
        new FixedSizeList(this.dimension, new Field('item', new Float32(), true)),
        true,
      ),
      new Field('text', new Utf8(), true),
      new Field('title', new Utf8(), true),
      new Field('tags', new Utf8(), true),
      new Field('category', new Utf8(), true),
      new Field('updated_at', new Utf8(), true),
    ]);

    try {
      this.table = await this.db.createEmptyTable(notesTableName, schema);
      this.log.info({ table: notesTableName, dimension: this.dimension }, 'lancedb.table_created');
    } catch {
      // Another process may have created it meanwhile.
      this.table = await this.db.openTable(notesTableName);
    }
  }

  async search(vector: number[], limit: number): Promise<SearchHit[]> {
    const table = await this.requireTable();
    if (vector.length !== this.dimension) {
      throw new Error(`Vector de consulta con dimensión ${vector.length}; se esperaba ${this.dimension}.`);
    }

    const rows = (await table.vectorSearch(vector).limit(limit).toArray()) as Array<
      Record<string, unknown> & { _distance?: number }
    >;

    return rows.map((row) => ({
      id: String(row.id ?? ''),
      notePath: String(row.note_path ?? ''),
      chunkIndex: Number(row.chunk_index ?? 0),
      title: String(row.title ?? ''),
      tags: parseTags(row.tags),
      category: String(row.category ?? ''),
      text: String(row.text ?? ''),
      updatedAt: String(row.updated_at ?? ''),
      distance: Number(row._distance ?? 0),
    }));
  }

  async upsertNote(notePath: string, rows: VectorRow[]): Promise<void> {
    const table = await this.requireTable();
    if (rows.length === 0) {
      await table.delete(`note_path = '${escapeSql(notePath)}'`);
      return;
    }

    // Inserta primero con ids nuevos; si la inserción falla, los chunks
    // anteriores siguen ahí. Después elimina solo los chunks viejos.
    const fresh = rows.map((row) => ({ ...row, id: `${row.id}-${randomUUID()}` }));
    await table.add(fresh as unknown as Record<string, unknown>[]);
    const ids = fresh.map((row) => `'${escapeSql(row.id)}'`).join(', ');
    await table.delete(`note_path = '${escapeSql(notePath)}' AND id NOT IN (${ids})`);
  }

  async deleteByPath(notePath: string): Promise<void> {
    const table = await this.requireTable();
    await table.delete(`note_path = '${escapeSql(notePath)}'`);
  }

  async count(): Promise<number> {
    const table = await this.requireTable();
    return table.countRows();
  }

  async clear(): Promise<void> {
    const db = await this.requireDb();
    if ((await db.tableNames()).includes(notesTableName)) {
      await db.dropTable(notesTableName);
    }
    this.table = undefined;
    await this.open();
  }

  async close(): Promise<void> {
    await this.db?.close();
    this.db = undefined;
    this.table = undefined;
  }

  private async requireDb(): Promise<Connection> {
    if (!this.db) await this.open();
    if (!this.db) throw new Error('LanceDB no está inicializado.');
    return this.db;
  }

  private async requireTable(): Promise<Table> {
    if (!this.table) await this.open();
    if (!this.table) throw new Error('La tabla de LanceDB no está inicializada.');
    return this.table;
  }
}

function parseTags(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
}
