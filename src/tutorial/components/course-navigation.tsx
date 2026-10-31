import { useEffect, useState } from "react";
import { chaptersForVersion, lessonPath, lessonsForVersion } from "../content";
import type { RubyVersion } from "../../versions";

export function CourseNavigation({
  version,
  slug,
}: {
  version: RubyVersion;
  slug?: string;
}) {
  const lessons = lessonsForVersion(version);
  return (
    <nav aria-label="Course contents">
      {chaptersForVersion(version)
        .filter((chapter) =>
          lessons.some((lesson) => lesson.chapter === chapter),
        )
        .map((chapter) => (
          <section
            key={chapter}
            className={slug ? "sidebar-chapter" : "course-chapter"}
          >
            <h3>{chapter}</h3>
            {slug ? (
              lessons
                .filter((lesson) => lesson.chapter === chapter)
                .map((lesson) => (
                  <a
                    key={lesson.slug}
                    data-lesson-link={lesson.slug}
                    aria-current={lesson.slug === slug ? "page" : undefined}
                    href={lessonPath(version, lesson.slug)}
                  >
                    <span className="lesson-number">
                      {String(lessons.indexOf(lesson) + 1).padStart(2, "0")}
                    </span>
                    <span>{lesson.title}</span>
                  </a>
                ))
            ) : (
              <div className="lesson-cards">
                {lessons
                  .filter((lesson) => lesson.chapter === chapter)
                  .map((lesson) => (
                    <a
                      key={lesson.slug}
                      className="lesson-card"
                      data-lesson-link={lesson.slug}
                      href={lessonPath(version, lesson.slug)}
                    >
                      <span className="lesson-number">
                        {String(lessons.indexOf(lesson) + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong>{lesson.title}</strong>
                        <p>{lesson.goal}</p>
                      </div>
                      <span aria-hidden="true">→</span>
                    </a>
                  ))}
              </div>
            )}
          </section>
        ))}
    </nav>
  );
}

export function CourseSidebar({
  version,
  slug,
}: {
  version: RubyVersion;
  slug: string;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (matchMedia("(max-width: 760px)").matches) setOpen(false);
  }, []);
  return (
    <aside className="course-sidebar">
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>Course contents</summary>
        <CourseNavigation version={version} slug={slug} />
      </details>
    </aside>
  );
}
