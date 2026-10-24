export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tells the client which channels have server-side credentials configured. */
export async function GET() {
  const has = (base?: string, key?: string) => Boolean(base?.trim() && key?.trim());
  return Response.json(
    {
      text: has(process.env.OPENAI_BASE_URL, process.env.OPENAI_API_KEY),
      image: has(process.env.IMAGE_BASE_URL, process.env.IMAGE_API_KEY),
      speech: has(process.env.SPEECH_BASE_URL, process.env.SPEECH_API_KEY),
      embedding: has(process.env.EMBED_BASE_URL, process.env.EMBED_API_KEY),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
