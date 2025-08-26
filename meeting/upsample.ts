import { PassThrough } from "stream";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";

ffmpeg.setFfmpegPath(ffmpegPath!);

export function writeWavFile(
  buffer: Buffer,
  sampleRate = 48000,
  filename = "debug_output.wav"
) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(buffer.length, 40);
  fs.writeFileSync(filename, Buffer.concat([header, buffer]));
}
