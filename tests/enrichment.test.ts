import { describe, expect, it, vi } from "vitest";
import {
  buildChannelUrl,
  enrichChannels,
  parsePublicChannelPage,
} from "../src/core/enrichment";
import type { VideoRecord } from "../src/shared/types";

const channelId = "UCabcdefghijklmnopqrstuv";
const video = (
  extra: Partial<VideoRecord> & { channelUrl?: string } = {},
): VideoRecord & { channelUrl?: string } => ({
  id: "abcdefghijk",
  title: "Test",
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  channelId,
  ...extra,
});
const html = (content: string) =>
  new Response(content, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("public channel parsing", () => {
  it("reads literal subscriberCountText simpleText and a JSON-escaped title", () => {
    const result = parsePublicChannelPage(
      '<script>var data={"subscriberCountText":{"simpleText":"1.2M subscribers"},"channelMetadataRenderer":{"title":"Canal \\u00c1rvore"}}</script>',
    );
    expect(result).toEqual({
      source: "public-youtube",
      subscribers: 1200000,
      channelName: "Canal Árvore",
      warnings: [],
    });
  });
  it("accepts runs, literal strings and modern metadata text", () => {
    expect(
      parsePublicChannelPage(
        '{"subscriberCountText":{"runs":[{"text":"1,2 mil"},{"text":" inscritos"}]}}',
      ).subscribers,
    ).toBe(1200);
    expect(
      parsePublicChannelPage('{"subscriberCountText":"234 subscribers"}')
        .subscribers,
    ).toBe(234);
    expect(
      parsePublicChannelPage(
        '{"metadataParts":[{"text":{"content":"3,4 milhões de inscritos"}}]}',
      ).subscribers,
    ).toBe(3400000);
    expect(
      parsePublicChannelPage(
        '{"metadataParts":[{"text":{"content":"3,4 milhões inscritos"}}]}',
      ).subscribers,
    ).toBe(3400000);
  });
  it("uses named HTML metadata without confusing views and subscriber counts", () => {
    const result = parsePublicChannelPage(
      '<meta content="Canal &amp; Música - YouTube" property="og:title"><meta name="subscriberCount" content="1,234"><meta itemprop="interactionCount" content="9999">',
    );
    expect(result.channelName).toBe("Canal & Música");
    expect(result.subscribers).toBe(1234);
    expect(
      parsePublicChannelPage(
        '<meta itemprop="interactionCount" content="9999">',
      ).subscribers,
    ).toBeUndefined();
  });
  it("never evaluates scripts or replaces missing/hidden counts with zero", () => {
    expect(
      parsePublicChannelPage(
        '<script>throw new Error("must not execute")</script>{"subscriberCountText":{"simpleText":"Inscritos ocultos"}}',
      ).subscribers,
    ).toBeUndefined();
    expect(parsePublicChannelPage("").warnings).toHaveLength(1);
    expect(
      parsePublicChannelPage('{"subscriberCountText":"0 subscribers"}')
        .subscribers,
    ).toBe(0);
  });
});

describe("channel network target validation", () => {
  it("builds canonical channel IDs and handles including Unicode", () => {
    expect(buildChannelUrl(video())).toBe(
      `https://www.youtube.com/channel/${channelId}`,
    );
    expect(
      buildChannelUrl(
        video({
          channelId: undefined,
          channelUrl: "https://www.youtube.com/@canal",
        }),
      ),
    ).toBe("https://www.youtube.com/@canal");
    expect(
      buildChannelUrl(
        video({
          channelId: undefined,
          channelUrl: "https://www.youtube.com/@música",
        }),
      ),
    ).toBe("https://www.youtube.com/@m%C3%BAsica");
  });
  it.each([
    "https://evil.test/@foo",
    "https://www.youtube.com.evil.test/@foo",
    "https://user:pass@www.youtube.com/@foo",
    "http://www.youtube.com/@foo",
    "https://www.youtube.com/@foo?x=1",
    "https://www.youtube.com/@foo#x",
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://www.youtube.com/@foo%2Fbar",
    "https://www.youtube.com/@foo\\bar",
    "https://www.youtube.com:8443/@foo",
    "https://www.youtube.com/evil/../@foo",
  ])("rejects %s", (channelUrl) => {
    expect(
      buildChannelUrl(video({ channelId: undefined, channelUrl })),
    ).toBeUndefined();
  });
});

describe("bounded explicit enrichment", () => {
  it("fetches each channel once, omits credentials, and does not mutate inputs", async () => {
    const fetcher = vi.fn(async () =>
      html(
        '{"subscriberCountText":"1,2 mil inscritos","channelMetadataRenderer":{"title":"Canal"}}',
      ),
    );
    const input = [video(), video({ id: "anotherid01" })];
    const result = await enrichChannels(input, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toBeDefined();
    expect(result.videos.map((item) => item.subscribers)).toEqual([1200, 1200]);
    expect(input[0].subscribers).toBeUndefined();
    const init = (
      fetcher.mock.calls as unknown as [string, RequestInit][]
    )[0][1];
    expect(init).toMatchObject({
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("limits actions to ten channels and performs requests sequentially", async () => {
    let active = 0,
      maxActive = 0;
    const fetcher = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return html('{"subscriberCountText":"10 subscribers"}');
    });
    const input = Array.from({ length: 12 }, (_, index) =>
      video({
        id: String(index),
        channelId: `UC${String(index).padStart(22, "a")}`,
      }),
    );
    const result = await enrichChannels(input, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(maxActive).toBe(1);
    expect(result.videos[10].subscribers).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("Limite de 10");
  });
  it("keeps unknown subscribers on error/missing data and preserves known counts", async () => {
    const known = video({ subscribers: 5 });
    const failed = await enrichChannels(
      [video(), known],
      async () => new Response("no", { status: 503 }),
    );
    expect(failed.videos[0].subscribers).toBeUndefined();
    expect(failed.videos[1].subscribers).toBe(5);
    expect(failed.warnings.join(" ")).toContain("HTTP 503");
    const missing = await enrichChannels([video()], async () =>
      html("<html>Consent required</html>"),
    );
    expect(missing.videos[0].subscribers).toBeUndefined();
    expect(missing.warnings.length).toBeGreaterThan(0);
  });
  it("rejects oversized declared pages and streamed data before parsing", async () => {
    const declared = await enrichChannels(
      [video()],
      async () =>
        new Response("small", {
          headers: {
            "content-type": "text/html",
            "content-length": String(3 * 1024 * 1024 + 1),
          },
        }),
    );
    expect(declared.warnings.join(" ")).toContain("3 MiB");
    const streamed = await enrichChannels([video()], async () =>
      html("x".repeat(3 * 1024 * 1024 + 1)),
    );
    expect(streamed.warnings.join(" ")).toContain("3 MiB");
    expect(streamed.videos[0].subscribers).toBeUndefined();
  });
  it("skips unavailable channel identities and aborts before future fetches", async () => {
    const fetcher = vi.fn(async () => html(""));
    const controller = new AbortController();
    controller.abort();
    const aborted = await enrichChannels([video()], fetcher, controller.signal);
    expect(fetcher).not.toHaveBeenCalled();
    expect(aborted.warnings.join(" ")).toContain("cancelado");
    await enrichChannels(
      [video({ channelId: undefined }), video({ subscribers: 20 })],
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
