import { lessonPath, lessonsForVersion, type LessonContent } from "../content";
import { officialReferences } from "../references";
import { RUBY_RELEASES, type RubyVersion } from "../../versions";
import { useLessonPlayground } from "../use-lesson-playground";
import Playground, { SampleChoice } from "./playground";
import { CourseSidebar } from "./course-navigation";

function LessonNavigation({
  lesson,
  version,
}: {
  lesson: LessonContent;
  version: RubyVersion;
}) {
  const lessons = lessonsForVersion(version);
  const index = lessons.findIndex((item) => item.slug === lesson.slug);
  const previous = lessons[index - 1];
  const next = lessons[index + 1];
  return (
    <nav className="lesson-navigation" aria-label="Lesson navigation">
      <div>
        {previous ? (
          <>
            <span>Previous</span>
            <a href={lessonPath(version, previous.slug)}>{previous.title}</a>
          </>
        ) : (
          <a href={`/tutorial/${version}/`}>All lessons</a>
        )}
      </div>
      <div>
        <span>{next ? "Next lesson" : "Keep exploring"}</span>
        {next ? (
          <a href={lessonPath(version, next.slug)}>{next.title}</a>
        ) : (
          <a href={`/tutorial/${version}/`}>Back to your learning path</a>
        )}
      </div>
    </nav>
  );
}

export default function Lesson({
  lesson,
  version,
}: {
  lesson: LessonContent;
  version: RubyVersion;
}) {
  const release = RUBY_RELEASES.find((item) => item.id === version)!;
  const lessons = lessonsForVersion(version);
  const index = lessons.findIndex((item) => item.slug === lesson.slug);
  const playground = useLessonPlayground(
    lesson.code,
    lesson.experiments,
    version,
  );
  return (
    <div className="lesson-layout">
      <CourseSidebar version={version} slug={lesson.slug} />
      <article>
        <p className="eyebrow">
          Lesson {index + 1} of {lessons.length} · {release.label}
        </p>
        <h1>{lesson.title}</h1>
        <p className="lead">{lesson.goal}</p>
        {release.channel === "development" && (
          <p className="version-note">
            Development course: behavior may change with future runtime updates.
          </p>
        )}
        {lesson.versionNote && (
          <p className="version-note">{lesson.versionNote}</p>
        )}
        <div className="lesson-workspace">
          <div className="lesson-explanation">
            <section aria-labelledby="learn">
              <h2 id="learn">Learn</h2>
              {lesson.paragraphs.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
            </section>
            <section aria-labelledby="example">
              <h2 id="example">Example</h2>
              <div id="sample-example" data-sample-control>
                <SampleChoice playground={playground} id="example" />
              </div>
              <pre className="example-code">
                <code>{lesson.code}</code>
              </pre>
            </section>
            <section aria-labelledby="practice">
              <h2 id="practice">Experiment</h2>
              <ul className="experiments">
                {lesson.experiments.map((experiment) => (
                  <li key={experiment.id} data-experiment={experiment.id}>
                    <div
                      id={`sample-experiment:${experiment.id}`}
                      data-sample-control
                    >
                      <SampleChoice
                        playground={playground}
                        id={`experiment:${experiment.id}`}
                      />
                    </div>
                    <p>{experiment.task}</p>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="references">
              <h2 id="references">Explore the official manual</h2>
              <ul>
                {officialReferences(lesson, release).map((reference) => (
                  <li key={reference.url}>
                    <a href={reference.url}>{reference.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="lesson-editor">
            <div
              id="tutorial-runner"
              data-lesson={lesson.slug}
              data-version={version}
            >
              <Playground playground={playground} />
            </div>
          </div>
        </div>
        <LessonNavigation lesson={lesson} version={version} />
      </article>
    </div>
  );
}
