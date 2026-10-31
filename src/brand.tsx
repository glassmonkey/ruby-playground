import RubyMark from "./ruby-mark";

/** Shared site identity; the page chooses whether it is a heading or home link. */
export default function Brand({ heading = false }: { heading?: boolean }) {
  const content = (
    <>
      <RubyMark />
      <span className="site-brand-title">
        <span className="site-brand-ruby">Ruby</span> Playground
      </span>
    </>
  );
  return heading ? (
    <h1 className="site-brand">{content}</h1>
  ) : (
    <a className="site-brand" href="/">
      {content}
    </a>
  );
}
