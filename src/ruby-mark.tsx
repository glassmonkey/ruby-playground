import { designTokens } from "./design-tokens";

export default function RubyMark({
  boxSize = 12,
  sizePx,
}: {
  boxSize?: number;
  sizePx?: number;
}) {
  const ruby = designTokens.ruby;
  return (
    <svg
      viewBox="0 0 40 40"
      width={sizePx ?? `${boxSize / 4}rem`}
      height={sizePx ?? `${boxSize / 4}rem`}
      aria-hidden="true"
      focusable="false"
    >
      <path fill={ruby[600]} d="M10 5h20l8 12-18 20L2 17Z" />
      <path fill={ruby[300]} d="m10 5 10 12H2Z" />
      <path fill={ruby[500]} d="M10 5h20L20 17Z" />
      <path fill={ruby[700]} d="m30 5 8 12H20L20 37Z" />
      <path fill={ruby[800]} d="M38 17 20 37 20 17Z" />
    </svg>
  );
}
