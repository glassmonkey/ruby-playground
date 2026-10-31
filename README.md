# Ruby Playground

Ruby Playground is a free website for writing and running Ruby in your browser:
<https://ruby-play.dev/>. Type Ruby in the editor and the output updates as you
edit. You can switch between Ruby versions and share code by copying the URL.
No installation or account is required. Ruby runs inside the browser with
[ruby.wasm](https://github.com/ruby/ruby.wasm), so your code is not sent to a
server to be executed.

![Ruby Playground running the sample program, with the editor on the left and its output on the right](docs/images/playground.png)

The site also includes a step-by-step [Ruby tutorial](https://ruby-play.dev/tutorial/)
whose lessons run code in the page.

![A Ruby tutorial lesson with the explanation on the left and runnable code on the right](docs/images/tutorial.png)

## Features

- Live execution. Code runs 350 ms after you stop typing. Standard output,
  standard error and exceptions appear in the Output panel as plain text. Use
  `puts` or `p` to print values; expression return values are not shown
  automatically.
- Ruby versions. Choose Ruby 4.0, 3.4, 3.3, 3.2 or a 4.1 development snapshot.
  A panel shows the running VM's version, platform, encoding, release date and
  revision.
- Sharing by URL. The code and selected version are saved in the address bar as
  you edit. Copy the URL to share an example or bookmark it. Opening a shared
  link restores the code and runs it.
- Ruby tutorial. 23 lessons in 10 chapters, from printing values to classes,
  exceptions and pattern matching. Each lesson has an explanation, an example
  and two or three experiments to run and edit. Each Ruby version has its own
  course at `/tutorial/{version}/`.
- Light and dark themes. The theme follows your system setting, and a theme you
  choose is remembered across reloads.

## Ruby versions

The selector offers these bundled runtimes. Only the selected runtime is
downloaded, about 30 to 36 MB each.

- Ruby 4.0 (default): Ruby 4.0.0 from `@ruby/4.0-wasm-wasi` 2.10.1
- Ruby 3.4: Ruby 3.4.1 from `@ruby/3.4-wasm-wasi` 2.10.1
- Ruby 3.3: Ruby 3.3.3 from `@ruby/3.3-wasm-wasi` 2.10.1
- Ruby 3.2: Ruby 3.2.4 from `@ruby/3.2-wasm-wasi` 2.10.1
- Ruby 4.1 development: Ruby 4.1.0dev from `@ruby/head-wasm-wasi`
  2.10.1-2026-10-28-a (revision `79de9be7d8`). This snapshot is pinned and is
  not updated nightly.

These are the official ruby.wasm builds, and they are not the latest Ruby patch
releases. Ruby 4.0.0, 3.4.1 and 3.3.3 do not include the
[regexp security fixes released on 2026-10-23](https://www.ruby-lang.org/en/news/2026/10/23/regexp-fixes-for-gitlab-cves/)
in 4.0.9, 3.4.12 and 3.3.13.

## Limitations

- Programs are single files. Standard input (`gets`), Rails, additional gems and
  saved snippets are not supported.
- Each run starts in a new Ruby VM, so variables, constants and files from
  earlier runs are not kept.
- A run, including loading Ruby, stops after 20 seconds. Captured output is
  limited to 100 KB and code to 50,000 characters. A share URL is limited to
  8,000 bytes; longer code still runs but is not saved in the URL.
- The first run downloads the selected runtime and can be slow on a slow
  connection.

## Security and privacy

- Code runs in your browser in a Web Worker. Each run uses a new Worker and
  Ruby VM, and Ruby's JavaScript bridge is disabled. The Worker keeps the page
  responsive and separates runs, but it is not a security sandbox for hostile
  code. Run only code you trust.
- Shared links run automatically when opened, and the URL contains the full
  source code. Do not open links from sources you do not trust, and keep
  passwords and personal information out of your code. Because the code is part
  of the URL, it can remain in browser history and in hosting request logs.
- The site is a static site on GitHub Pages. There are no accounts and no
  application backend, and the site uses no analytics or advertising. See the
  [privacy policy](https://ruby-play.dev/privacy.html).

## Feedback and contributing

Report bugs and request features in
[GitHub issues](https://github.com/glassmonkey/ruby-playground/issues). For
local setup, tests, deployment and tutorial authoring, see
[docs/contributing.md](docs/contributing.md).

You can support the project through
[GitHub Sponsors](https://github.com/sponsors/glassmonkey).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The build
configuration is adapted from
[php-playground](https://github.com/glassmonkey/php-playground). License
notices for Ruby, ruby.wasm and other bundled packages are in
[assets/licenses/](assets/licenses/).
