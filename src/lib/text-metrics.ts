/**
 * Text metrics shared by the chat tool `measure` and the MCP tool
 * `measure_text`. One implementation, so a length check cannot disagree with
 * itself depending on which entry point the model used.
 */
export type TextMetrics = {
  characters: number;
  paragraphs: number;
  longestSentence: number;
  readSeconds: number;
};

export function measureText(text: string): TextMetrics {
  const paragraphs = text.split(/\n+/).filter((line) => line.trim().length > 0);
  const sentences = text.split(/[。！？!?；;]/).filter((line) => line.trim().length > 0);
  const longest = sentences.reduce((max, line) => Math.max(max, line.trim().length), 0);
  return {
    characters: text.replace(/\s/g, '').length,
    paragraphs: paragraphs.length,
    longestSentence: longest,
    readSeconds: Math.round((text.length / 5.2) * 10) / 10,
  };
}
