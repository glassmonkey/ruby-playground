import { Resvg } from "@resvg/resvg-js";
import { renderToStaticMarkup } from "react-dom/server";
import RubyMark from "../ruby-mark";
import { designTokens } from "../design-tokens";
import type { LessonContent } from "./content";
import { RUBY_RELEASES, type RubyVersion } from "../versions";

export const socialImageSize = { width: 1200, height: 630 };

// Bound every text region so future lesson titles cannot overlap the footer.
function lines(text: string, length: number, limit: number): string[] {
  const words = text.trim().split(/\s+/);
  const result: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > length) {
      result.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) result.push(line);
  if (result.length > limit) result[limit - 1] += "…";
  return result.slice(0, limit);
}

function Title({ text }: { text: string }) {
  const size = text.length > 46 ? 36 : 45;
  return (
    <>
      {lines(text, size === 36 ? 23 : 18, 4).map((line, index) => (
        <text
          key={index}
          x="64"
          y={221 + index * size * 1.3}
          fontSize={size}
          fill={designTokens.colors.text.default}
          {...(line.length * size * 0.65 > 448
            ? { textLength: 448, lengthAdjust: "spacingAndGlyphs" }
            : {})}
        >
          {line}
        </text>
      ))}
    </>
  );
}

export function renderSocialImage(
  version: RubyVersion,
  lesson: LessonContent | undefined,
  fontFile: string,
): Buffer {
  const { colors, ruby } = designTokens;
  const release = RUBY_RELEASES.find((item) => item.id === version)!;
  const badgeWidth = release.channel === "development" ? 336 : 152;
  const svg = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      {...socialImageSize}
      viewBox="0 0 1200 630"
      fontFamily="Plus Jakarta Sans"
    >
      <rect width="1200" height="630" fill={colors.pageBg.default} />
      <text x="64" y="108" fontSize="61" fontWeight="700" fill={ruby[700]}>
        RUBY TUTORIAL
      </text>
      <rect
        x={1128 - badgeWidth}
        y="62"
        width={badgeWidth}
        height="46"
        rx="23"
        fill={ruby[100]}
      />
      <text
        x={1128 - badgeWidth / 2}
        y="93"
        textAnchor="middle"
        fontSize="23"
        fill={ruby[800]}
      >
        {release.label}
      </text>
      <Title text={lesson?.title ?? "Learn Ruby in your browser"} />
      <text x="64" y="451" fontSize="27" fill={colors.mutedText.default}>
        Learn by running code
      </text>
      <text x="64" y="492" fontSize="27" fill={colors.mutedText.default}>
        in your browser.
      </text>
      <rect
        x="568"
        y="180"
        width="568"
        height="331"
        rx="18"
        fill={colors.panelBg._dark}
      />
      <rect
        x="568"
        y="180"
        width="568"
        height="55"
        rx="18"
        fill={colors.frameBg._dark}
      />
      <text x="593" y="216" fontSize="18" fill={colors.mutedText._dark}>
        ● ● ●
      </text>
      <text x="690" y="216" fontSize="21" fill={colors.text._dark}>
        Try it yourself
      </text>
      {(lesson?.code ?? 'name = "Ruby"\nputs "Hello, #{name}!"')
        .split("\n")
        .slice(0, 5)
        .map((line, index) => (
          <g key={index}>
            <text
              x="593"
              y={278 + index * 31}
              fontSize="18"
              fill={colors.mutedText.default}
            >
              {index + 1}
            </text>
            <text
              x="630"
              y={278 + index * 31}
              fontSize="21"
              xmlSpace="preserve"
              fill={ruby[300]}
            >
              {line.length > 35 ? `${line.slice(0, 34)}…` : line}
            </text>
          </g>
        ))}
      <text x="598" y="477" fontSize="20" fill={colors.mutedText._dark}>
        {(lesson?.code.split("\n").length ?? 2) > 5
          ? "… Explore the full example"
          : "Edit. Run. Explore."}
      </text>
      <rect x="972" y="441" width="132" height="48" rx="10" fill={ruby[600]} />
      <text x="996" y="474" fontSize="24" fill="#ffffff">
        ▶ Run
      </text>
      <g transform="translate(64 558)">
        <RubyMark sizePx={40} />
      </g>
      <text x="116" y="587" fontSize="23" fill={colors.mutedText.default}>
        Ruby Playground
      </text>
      <text
        x="1128"
        y="587"
        textAnchor="end"
        fontSize="21"
        fill={colors.mutedText.default}
      >
        ruby-play.dev
      </text>
    </svg>,
  );
  return new Resvg(svg, {
    font: {
      fontFiles: [fontFile],
      loadSystemFonts: false,
      defaultFontFamily: "Plus Jakarta Sans",
    },
  })
    .render()
    .asPng();
}
