import { describe, expect, it } from 'vitest';
import { parseTranscript, parseTranscriptImport, TranscriptImportError, transcriptMarkdown } from '../src/core/transcript';

const valid = '00:00:03.125 --> 00:00:05.750\nFala válida 🪐';
const invalid = '00:00:09.000 --> 00:00:08.000\nFim invertido';
describe('atomic caption imports with explicit diagnostics', () => {
  it('rejects mixed valid/invalid VTT without returning a partial set, with the original cue line', () => {
    const content = `WEBVTT\n\n${valid}\n\n${invalid}`;
    expect(parseTranscript(content)).toHaveLength(1); // Legacy observed/tolerant contract remains separate.
    try { parseTranscriptImport(content, { fileName: 'captions.vtt' }); expect.unreachable(); }
    catch (error) {
      expect(error).toBeInstanceOf(TranscriptImportError); const diagnostic = error as TranscriptImportError;
      expect(diagnostic.diagnostics).toMatchObject([{ line: 6, code: 'invalid-timing' }]); expect(diagnostic.message).toContain('nenhum trecho foi aplicado');
    }
  });
  it('keeps IDs/settings, multiline speech, metadata, CRLF/BOM and all fractional timestamps in valid imports', () => {
    const content = '\uFEFFWEBVTT Fixture\r\nLanguage: pt\r\n\r\nNOTE não é fala\r\n00:00:00.000 --> horário em comentário\r\n\r\nSTYLE\r\n::cue { color: lime }\r\n\r\nREGION\r\nid:local\r\n\r\ncue-a\r\n00:00:03.125 --> 00:00:05.750 align:start\r\n<v Pessoa><b>Fala</b> &amp; café 🪐</v>\r\nsegunda linha\r\n';
    expect(parseTranscriptImport(content, { fileName: 'captions.vtt' })).toEqual([{ start: 3.125, duration: 2.625, text: 'Fala & café 🪐 segunda linha' }]);
    expect(parseTranscriptImport('1\n00:00:03,125 --> 00:00:05,750\nFala válida 🪐', { fileName: 'captions.srt' })).toEqual([{ start: 3.125, duration: 2.625, text: 'Fala válida 🪐' }]);
  });
  it('file hints prevent malformed captions from silently becoming plain text', () => {
    for (const content of ['1\nBAD TIMING\nFala perdida', '00:00:09.000 --> 00:00:08.000\nFim invertido', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<b></b>', `WEBVTT\n${valid}`, `WEBVTT\n\n${valid}\n00:00:06.000 --> 00:00:07.000\nSegundo cue sem separador`]) expect(() => parseTranscriptImport(content, { fileName: 'invalid.srt' })).toThrow(TranscriptImportError);
    expect(parseTranscriptImport('Texto puro sem horários', { fileName: 'text.txt' })).toEqual([]);
    expect(parseTranscriptImport('[{"start":1.25,"duration":2,"text":"JSON conhecido"}]', { fileName: 'transcript.json' })).toEqual([{ start: 1.25, duration: 2, text: 'JSON conhecido' }]);
    expect(() => parseTranscriptImport('WEBVTT\n\nNOTE sem fala', { fileName: 'empty.vtt' })).toThrow('Nenhum cue de fala');
  });
  it('refuses silent cue truncation and bounds diagnostics for large malformed files', () => {
    const cue = '00:00:00.000 --> 00:00:01.000\nFala';
    expect(parseTranscriptImport(`WEBVTT\n\n${Array(5000).fill(cue).join('\n\n')}`, { fileName: 'limit.vtt' })).toHaveLength(5000);
    expect(() => parseTranscriptImport(`WEBVTT\n\n${Array(5001).fill(cue).join('\n\n')}`, { fileName: 'over.vtt' })).toThrow('5000 cues');
    try { parseTranscriptImport(`WEBVTT\n\n${Array(75).fill(invalid).join('\n\n')}`); expect.unreachable(); }
    catch (error) { const result = error as TranscriptImportError; expect(result.diagnosticCount).toBe(75); expect(result.diagnostics).toHaveLength(50); expect(result.message).toContain('75 problemas'); }
    expect(() => parseTranscriptImport('x'.repeat(5_000_001))).toThrow('5 milhões');
  });
  it('Markdown keeps the real 3.125-second start rather than dropping its fraction', () => {
    const markdown = transcriptMarkdown(parseTranscriptImport(`WEBVTT\n\n${valid}`), 'Fração conhecida');
    expect(markdown).toContain('**00:00:03.125** Fala válida 🪐'); expect(markdown).not.toContain('**00:00:03**');
  });
});
