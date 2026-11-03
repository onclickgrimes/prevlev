// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { selectComments, validateCommentFilter, stableCommentFingerprint, describeCommentScope, commentRows, commentsText } from "../src/core/comments";
import { readComments } from "../src/content/youtube";
import { toCsv } from "../src/core/export";
import type { CommentRecord } from "../src/shared/types";

const comments: CommentRecord[] = [
  { id: "a", author: "  João   Azul ", text: " Como   criar café? ", likes: 10, replies: 2, hearted: true },
  { id: "b", author: "Ana", text: "Como criar café sem interrogação", likes: 0, replies: 0, hearted: false },
  { id: "c", author: "João Azul", text: "Por quê？", likes: 20, replies: 5 },
  { id: "d", author: "Pessoa", text: "Dados ausentes" },
];

describe("complete local comment filters", () => {
  it("normalizes text/author spacing and accents while preserving readable text and input data", () => {
    const selected = selectComments(comments, { query: "criar   cafe", author: "joao azul" });
    expect(selected.map(comment => comment.id)).toEqual(["a"]);
    expect(selected[0]).toMatchObject({ author: "João Azul", text: "Como criar café?" });
    expect(comments[0].text).toBe(" Como   criar café? ");
  });
  it("uses punctuation alone for questions and never guesses an interrogative sentence", () => {
    expect(selectComments(comments, { questionsOnly: true }).map(comment => comment.id)).toEqual(["a", "c"]);
  });
  it("applies inclusive min/max likes/replies and treats zero separately from unknown", () => {
    expect(selectComments(comments, { minLikes: 10, maxLikes: 10, minReplies: 2, maxReplies: 2 }).map(comment => comment.id)).toEqual(["a"]);
    expect(selectComments(comments, { minLikes: 0, maxLikes: 0 }).map(comment => comment.id)).toEqual(["b"]);
    expect(selectComments(comments, { maxReplies: 0 }).map(comment => comment.id)).toEqual(["b"]);
    expect(selectComments(comments, { minLikes: 0 }).map(comment => comment.id)).toEqual(["a", "b", "c"]);
  });
  it("separates known reply/heart states from unknown states", () => {
    expect(selectComments(comments, { replies: "yes" }).map(comment => comment.id)).toEqual(["a", "c"]);
    expect(selectComments(comments, { replies: "no", hearted: "no" }).map(comment => comment.id)).toEqual(["b"]);
    expect(selectComments(comments, { hearted: "yes" }).map(comment => comment.id)).toEqual(["a"]);
    expect(selectComments(comments, { hearted: "any" })).toHaveLength(4);
  });
  it("sorts known counters descending, preserves ties/default order and leaves unknown counters last", () => {
    expect(selectComments(comments, { sort: "likes" }).map(comment => comment.id)).toEqual(["c", "a", "b", "d"]);
    expect(selectComments(comments, { sort: "replies" }).map(comment => comment.id)).toEqual(["c", "a", "b", "d"]);
    expect(selectComments(comments).map(comment => comment.id)).toEqual(["a", "b", "c", "d"]);
    expect(selectComments([...comments, { id: "tie", author: "X", text: "Y", likes: 10 }], { sort: "likes" }).map(comment => comment.id)).toEqual(["c", "a", "tie", "b", "d"]);
  });
  it("rejects impossible or invalid ranges before filtering even an empty collection", () => {
    for (const filter of [{ minLikes: -1 }, { minReplies: NaN }, { maxLikes: Infinity }, { minLikes: 0.5 }, { minLikes: 5, maxLikes: 4 }, { minReplies: 2, maxReplies: 1 }]) expect(() => selectComments([], filter)).toThrow();
    expect(() => validateCommentFilter({ minLikes: 0, maxLikes: 0, replies: "any", hearted: "no", sort: "default" })).not.toThrow();
  });
  it("keeps invalid observed counters unknown under any active counter filter", () => {
    const invalid = [{ id: "a", author: "A", text: "T", likes: NaN, replies: -1 }, { id: "b", author: "A", text: "T", likes: 1.5, replies: Infinity }];
    expect(selectComments(invalid, { minLikes: 0 })).toEqual([]);
    expect(selectComments(invalid, { replies: "no" })).toEqual([]);
    expect(selectComments(invalid)[0].likes).toBeUndefined();
  });
  it("exports only the selected actual comments with safe CSV and honest loaded scope", () => {
    const selected = selectComments([...comments, { id: "local:xyz:1", author: "=CMD()", text: "=SUM(1)" }], { query: "=SUM" });
    const scope = describeCommentScope([...comments, ...selected], selected);
    expect(scope).toMatchObject({ loadedCount: 5, selectedCount: 1, knownLikes: 0, knownReplies: 0, knownHearts: 0, fingerprintCount: 1, confidence: "loaded-observations" });
    expect(commentsText(selected)).toBe("=CMD(): =SUM(1)");
    const csv = toCsv(commentRows(selected));
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain("'=SUM(1)");
    expect(commentRows(selected)[0].likes).toBeUndefined();
    expect(scope.limitations.join(" ")).toContain("não representa todos");
  });
});

describe("scoped loaded comment parsing", () => {
  it("reads a sibling thread reply count only for its main comment and refuses conflicting counters", () => {
    document.body.innerHTML = `<ytd-comment-thread-renderer><ytd-comment-view-model data-comment-id="main"><span id="content-text">Main</span></ytd-comment-view-model><ytd-comment-replies-renderer><button id="more-replies"><span id="text">3 respostas</span></button><ytd-comment-view-model data-comment-id="reply"><span id="content-text">Reply</span><span data-replies="0"></span></ytd-comment-view-model><ytd-comment-view-model data-comment-id="unknown"><span id="content-text">Unknown reply</span></ytd-comment-view-model></ytd-comment-replies-renderer></ytd-comment-thread-renderer><ytd-comment-thread-renderer><ytd-comment-view-model data-comment-id="other"><span id="content-text">Other thread</span></ytd-comment-view-model><ytd-comment-replies-renderer><span id="more-replies">8 respostas</span><span id="text">9 respostas</span></ytd-comment-replies-renderer></ytd-comment-thread-renderer>`;
    const comments = readComments(document);
    expect(comments.map(comment=>[comment.id,comment.replies])).toEqual([["main",3],["reply",0],["unknown",undefined],["other",undefined]]);
    expect(selectComments(comments,{minReplies:1}).map(comment=>comment.id)).toEqual(["main"]);
  });
  it("includes already loaded replies while deduplicating outer thread and nested comment components", () => {
    document.body.innerHTML = `<ytd-comments><ytd-comment-thread-renderer data-comment-id="main"><ytd-comment-view-model><a id="author-text">Autor</a><span id="content-text">Pergunta?</span><span id="vote-count-middle">1,2 mil</span><span id="more-replies">2 respostas</span><ytd-creator-heart-renderer><button aria-pressed="true"></button></ytd-creator-heart-renderer></ytd-comment-view-model><ytd-comment-replies-renderer><ytd-comment-view-model><a id="author-text">Resposta</a><span id="content-text">Texto respondido</span><span id="published-time-text"><a href="/watch?v=abcdefghijk&amp;lc=reply.1">agora</a></span><span data-likes="0"></span><span data-replies="0"></span><span data-hearted="false"></span></ytd-comment-view-model></ytd-comment-replies-renderer></ytd-comment-thread-renderer></ytd-comments>`;
    expect(readComments(document)).toEqual([
      { id: "main", author: "Autor", text: "Pergunta?", likes: 1200, replies: 2, hearted: true },
      { id: "reply.1", author: "Resposta", text: "Texto respondido", likes: 0, replies: 0, hearted: false },
    ]);
  });
  it("keeps unknown likes/replies/hearts unknown rather than turning missing controls into zero/false", () => {
    document.body.innerHTML = `<ytd-comment-view-model data-comment-id="a"><span id="content-text">Texto</span><a id="author-text">Autor</a></ytd-comment-view-model>`;
    expect(readComments(document)).toEqual([{ id: "a", text: "Texto", author: "Autor", likes: undefined, replies: undefined, hearted: undefined }]);
  });
  it("has stable fingerprint identity across reorder and whitespace differences without using DOM index", () => {
    const first = `<ytd-comment-view-model><span id="content-text">  Texto   estável? </span><a id="author-text">João</a></ytd-comment-view-model>`;
    const second = `<ytd-comment-view-model><span id="content-text">Outro</span><a id="author-text">Ana</a></ytd-comment-view-model>`;
    document.body.innerHTML = first + second;
    const ids = readComments(document).map(comment => comment.id).sort();
    document.body.innerHTML = second + first;
    expect(readComments(document).map(comment => comment.id).sort()).toEqual(ids);
    expect(ids.every(id => id.startsWith("local:"))).toBe(true);
    expect(stableCommentFingerprint("João", "Texto estável?")).toBe(stableCommentFingerprint("JOAO", "Texto   estável?"));
  });
  it("scopes collection to a supplied element and collapses duplicated IDs without merging counters", () => {
    document.body.innerHTML = `<section id="scope"><ytd-comment-view-model data-comment-id="same"><span id="content-text">Primeiro</span><span data-likes="1"></span></ytd-comment-view-model><ytd-comment-view-model data-comment-id="same"><span id="content-text">Duplicado</span><span data-likes="100"></span></ytd-comment-view-model></section><ytd-comment-view-model data-comment-id="outside"><span id="content-text">Fora</span></ytd-comment-view-model>`;
    expect(readComments(document.querySelector("#scope")!)).toEqual([{ id: "same", text: "Primeiro", author: "", likes: 1, replies: undefined, hearted: undefined }]);
  });
  it("does not trust comment-body links or foreign-domain links as the comment permalink", () => {
    document.body.innerHTML = `<ytd-comment-view-model><span id="content-text">Veja <a href="https://www.youtube.com/watch?v=abcdefghijk&amp;lc=other">outro comentário</a></span><a id="author-text">A</a><span id="published-time-text"><a href="https://evil.test/watch?lc=foreign">agora</a></span></ytd-comment-view-model>`;
    const parsed = readComments(document)[0];
    expect(parsed.id.startsWith("local:")).toBe(true);
    expect(parsed.id).not.toBe("other");
    expect(parsed.id).not.toBe("foreign");
  });
});
