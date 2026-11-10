import { describe, expect, it } from "vitest";
import greenhouseJob from "../../fixtures/greenhouse-job.json";
import { decodeEntities, escapedHtmlToText, htmlToText } from "@/lib/text/html";

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#39;d&#39; &#x2019;")).toBe("a & b <c> 'd' ’");
  });

  it("leaves unknown entities and invalid code points alone", () => {
    expect(decodeEntities("&madeup; &#0;")).toBe("&madeup; &#0;");
  });
});

describe("htmlToText", () => {
  it("turns list items into bullets and blocks into lines", () => {
    expect(htmlToText("<h2>Requirements</h2><ul><li>3+ years</li><li>Go</li></ul><p>Thanks</p>")).toBe(
      "Requirements\n\n- 3+ years\n- Go\n\nThanks",
    );
  });

  it("drops scripts and styles entirely", () => {
    expect(htmlToText("<p>Hi</p><script>alert(1)</script><style>p{}</style>")).toBe("Hi");
  });

  it("handles <br> and non-breaking spaces", () => {
    expect(htmlToText("a<br>b&nbsp;&nbsp;c")).toBe("a\nb c");
  });
});

describe("escapedHtmlToText on a real Greenhouse description", () => {
  const text = escapedHtmlToText(greenhouseJob.content);

  it("removes every tag", () => {
    expect(text).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(text).not.toContain("&lt;");
  });

  it("keeps the readable content", () => {
    expect(text).toContain("Discord");
    expect(text.length).toBeGreaterThan(500);
  });
});
