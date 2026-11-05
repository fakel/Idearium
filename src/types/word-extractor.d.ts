declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string;
  }

  class WordExtractor {
    extract(filePath: string): Promise<WordDocument>;
  }

  export = WordExtractor;
}
