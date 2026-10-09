import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const TIMEOUT_MS = 30_000;

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Speaks `text` with one of Microsoft's neural voices through the (unofficial, keyless) service
 * behind Edge's Read Aloud. `voice` is a full voice name like `pl-PL-ZofiaNeural`.
 */
export async function synthesizeEdge(input: {
  text: string;
  voice: string;
}): Promise<{ audio: Uint8Array; mediaType: string }> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(input.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(input.text));
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The Edge voice service took too long to answer.')),
        TIMEOUT_MS,
      );
      audioStream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      audioStream.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
      audioStream.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    const audio = Buffer.concat(chunks);
    if (!audio.byteLength) throw new Error('The Edge voice service sent no audio. Try again.');
    return { audio: new Uint8Array(audio), mediaType: 'audio/mpeg' };
  } finally {
    tts.close();
  }
}
