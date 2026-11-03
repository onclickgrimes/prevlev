import { describe, expect, it } from 'vitest';
import { transcriptCsv, transcriptExport, transcriptMarkdown, transcriptSourceMetadata, validateTranscriptInputSource, type TranscriptAiResult, type TranscriptInputSource } from '../src/core/transcript';

const segments = [{ start: 1, duration: 2, text: 'Texto do arquivo local.' }];
const snapshot = { title: 'Título da coleta sem relação com o arquivo', videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', videoId: 'abcdefghijk', exportedAt: '2026-11-03T12:00:00Z' };
const imported: TranscriptInputSource = { kind: 'imported-file', fileName: 'legendas próprias.vtt', importedAt: '2026-11-03T09:00:00-03:00', videoAssociation: 'none' };

describe('explicit transcript input provenance', () => {
  it('keeps an unassociated file separate from snapshot URL, ID and title in JSON, CSV and Markdown', () => {
    const metadata = { ...snapshot, inputSource: imported }, report = transcriptExport(segments, metadata);
    expect(report).toMatchObject({ title: 'Transcrição importada: legendas próprias.vtt', videoUrl: null, videoId: null, inputSource: { ...imported, importedAt: '2026-11-03T12:00:00.000Z' } });
    expect(report.limitations.join(' ')).toContain('não foram herdados');
    const csv = transcriptCsv(segments, metadata), markdown = transcriptMarkdown(segments, snapshot.title, metadata);
    for (const exported of [JSON.stringify(report), csv, markdown]) {
      expect(exported).not.toContain(snapshot.title); expect(exported).not.toContain(snapshot.videoUrl); expect(exported).not.toContain(snapshot.videoId);
      expect(exported).toContain('imported-file'); expect(exported).toContain('none'); expect(exported).toContain('legendas próprias.vtt');
    }
    expect(csv).toContain('"inputSourceKind"'); expect(csv).toContain('"inputFileName"'); expect(csv).toContain('"inputImportedAt"'); expect(csv).toContain('"videoAssociation"');
    expect(markdown).toContain('URL, ID e título do vídeo permanecem desconhecidos');
  });

  it('retains a declared association as a declaration and preserves observed-page and legacy APIs', () => {
    const declared = transcriptExport(segments, { ...snapshot, inputSource: { ...imported, videoAssociation: 'user-declared' } });
    expect(declared).toMatchObject({ title: snapshot.title, videoUrl: snapshot.videoUrl, videoId: snapshot.videoId, inputSource: { videoAssociation: 'user-declared' } });
    expect(declared.limitations.join(' ')).toContain('não foi verificado');
    expect(transcriptMarkdown(segments, snapshot.title, { ...snapshot, inputSource: { ...imported, videoAssociation: 'user-declared' } })).toContain('declaração do usuário');
    expect(transcriptExport(segments, { ...snapshot, inputSource: { kind: 'observed-page', videoAssociation: 'observed' } })).toMatchObject({ title: snapshot.title, videoId: snapshot.videoId, inputSource: { kind: 'observed-page', videoAssociation: 'observed' } });
    const legacy = transcriptExport(segments, snapshot); expect(legacy).toMatchObject({ title: snapshot.title, videoUrl: snapshot.videoUrl, videoId: snapshot.videoId }); expect(legacy).not.toHaveProperty('inputSource');
    expect(transcriptCsv(segments, snapshot)).not.toContain('inputSourceKind');
  });

  it('does not infer a video from text, filename, or a former imported source after editing', () => {
    const edited: TranscriptInputSource = { ...imported, kind: 'edited-text', fileName: 'abcdefghijk.vtt' };
    const text = 'Texto menciona https://www.youtube.com/watch?v=abcdefghijk sem declarar associação.';
    const report = transcriptExport([], { ...snapshot, inputSource: edited }, {}, text);
    expect(report).toMatchObject({ title: 'Transcrição editada', videoUrl: null, videoId: null, text, timestampsAvailable: false, segments: [], inputSource: { kind: 'edited-text', videoAssociation: 'none' } });
    const changedSnapshot = transcriptSourceMetadata({ ...snapshot, title: 'Outra coleta', videoId: 'bbbbbbbbbbb', videoUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', inputSource: imported });
    expect(changedSnapshot).toEqual(transcriptSourceMetadata({ ...snapshot, inputSource: imported }));
  });

  it('validates source states, filename basenames and actual calendar timestamps with explicit timezone', () => {
    expect(validateTranscriptInputSource({ ...imported, fileName: 'Legenda 🪐.srt', importedAt: '2024-02-29T12:00:00+02:00' })).toMatchObject({ fileName: 'Legenda 🪐.srt', importedAt: '2024-02-29T10:00:00.000Z' });
    for (const source of [
      { kind: 'unknown', videoAssociation: 'none' }, { kind: 'observed-page', videoAssociation: 'none' }, { kind: 'imported-file', videoAssociation: 'observed' }, { kind: 'edited-text', videoAssociation: 'observed' },
      { kind: 'observed-page', videoAssociation: 'observed', fileName: 'file.vtt' }, { ...imported, videoAssociation: 'guessed' },
      ...['../file.vtt', '/tmp/file.vtt', 'C:\\file.vtt', 'bad\nfile.vtt', '..', '', 'a'.repeat(201)].map(fileName => ({ ...imported, fileName })),
      ...['2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z', '2026-11-03', '2026-11-03T12:00:00', '2026-11-03T24:00:00Z', '2026-11-03T12:61:00Z', 'not-a-date'].map(importedAt => ({ ...imported, importedAt })),
      { ...imported, privateToken: 'not part of this contract' },
    ]) expect(() => validateTranscriptInputSource(source as TranscriptInputSource)).toThrow('Proveniência');
  });

  it('binds generated result context to the same file/association and never borrows an observed-video result', () => {
    const source = validateTranscriptInputSource(imported);
    const result: TranscriptAiResult = { feature: 'transcript-summary', text: 'Resultado da fixture', generated: true, source: 'fixture:ai', model: 'fixture:text', requestedModel: 'fixture:text', origin: 'http://127.0.0.1:7814', backendOrigin: 'http://127.0.0.1:8787', receivedAt: '2026-11-03T12:01:00Z', context: { videoUrl: null, videoId: null, inputKind: 'timed-transcript', inputCharacters: segments[0].text.length, segmentCount: 1, inputSource: source } };
    const metadata = { ...snapshot, inputSource: imported, aiResults: [result] };
    const report = transcriptExport(segments, metadata); expect(report.aiResults?.[0].context).toMatchObject({ videoUrl: null, videoId: null, inputSource: source });
    for (const context of [
      { ...result.context, videoUrl: snapshot.videoUrl, videoId: snapshot.videoId },
      { ...result.context, inputSource: undefined },
      { ...result.context, inputSource: { ...source, fileName: 'outro.vtt' } },
      { ...result.context, inputSource: { ...source, videoAssociation: 'user-declared' as const } },
    ]) expect(transcriptExport(segments, { ...metadata, aiResults: [{ ...result, context }] })).not.toHaveProperty('aiResults');
    expect(transcriptExport(segments, { ...metadata, inputSource: { ...imported, fileName: 'outro.vtt' } })).not.toHaveProperty('aiResults');
  });
});
