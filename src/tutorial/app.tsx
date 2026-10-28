import Brand from "../brand";
import {
  lessonPath,
  lessonsForVersion,
  resolveLesson,
  tutorialVersions,
} from "./content";
import type { RubyVersion } from "../versions";
import HeaderControls from "./components/header-controls";
import { CourseNavigation } from "./components/course-navigation";
import Lesson from "./components/lesson";

function CourseHome({ version }: { version: RubyVersion }) {
  const release = tutorialVersions.find((item) => item.id === version)!;
  const lessons = lessonsForVersion(version);
  return (
    <div className="course-home">
      <p className="eyebrow">{release.label} · Learn in your browser</p>
      <h1>Ruby Tutorial</h1>
      <p className="lead">Learn Ruby, one experiment at a time.</p>
      <p>
        Write your first program, change it, and see what happens. Follow the
        lessons at your own pace — no installation needed.
      </p>
      {lessons[0] && (
        <a className="button" href={lessonPath(version, lessons[0].slug)}>
          Start learning Ruby
        </a>
      )}
      <h2>Your learning path</h2>
      <CourseNavigation version={version} />
    </div>
  );
}

export function TutorialApp({
  version,
  slug,
}: {
  version: RubyVersion;
  slug?: string;
}) {
  const release = tutorialVersions.find((item) => item.id === version)!;
  const lesson = slug ? resolveLesson(slug, version) : undefined;
  return (
    <>
      <header>
        <Brand />
        <a href="/tutorial/">Ruby Tutorial</a>
        <div
          id="tutorial-header-controls"
          data-version={version}
          data-lesson={slug ?? ""}
        >
          <HeaderControls version={version} slug={slug} />
        </div>
      </header>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <a href="/tutorial/">Tutorial</a>
        <span>›</span>
        <a href={`/tutorial/${version}/`}>{release.label}</a>
        {slug && (
          <>
            <span>›</span>
            <span>{lesson?.title ?? "Lesson"}</span>
          </>
        )}
      </nav>
      <main>
        {!slug ? (
          <CourseHome version={version} />
        ) : lesson ? (
          <Lesson
            key={`${version}/${slug}`}
            lesson={lesson}
            version={version}
          />
        ) : (
          <>
            <h1>This lesson is not available in {release.label}</h1>
            <p>
              Choose another version above or{" "}
              <a href={`/tutorial/${version}/`}>return to this course</a>.
            </p>
          </>
        )}
      </main>
      <footer>
        <a href="/">Open the playground</a> ·{" "}
        <a href="/tutorial/">Choose a tutorial version</a>
      </footer>
    </>
  );
}
export default TutorialApp;
