require "application_system_test_case"

class SnippetsTest < ApplicationSystemTestCase
  # The CRUD round trip deliberately stays off the playground. Compiling
  # ruby.wasm janks the renderer hard enough that Chrome drops synthesised
  # input outright, and none of these steps are about running Ruby anyway.
  test "an owner writes a snippet, renames it, then deletes it" do
    owner = users(:one)
    # Captured up front: reading the count after the delete races the request
    # still in flight, so the expectation itself would flap.
    titles_before = owner.snippets.pluck(:title)
    sign_in_as(owner)
    visit snippets_path

    click_on "New snippet"
    fill_in "Title", with: "Written by hand"
    fill_in "Code", with: "puts 'written by hand'"
    click_on "Create Snippet"

    assert_selector "#snippet-code", text: "puts 'written by hand'"

    click_on "Edit"
    fill_in "Title", with: "Renamed by hand"
    click_on "Update Snippet"

    assert_selector "h1", text: "Renamed by hand"

    accept_confirm { click_on "Delete" }

    assert_selector ".snippets__item", count: titles_before.size
  end

  test "the snippet list shows the owner their own snippets and nobody else's" do
    owner = users(:one)
    sign_in_as(owner)

    visit snippets_path

    # A count rather than assert_no_link: the list is empty on the sign-in page
    # too, so a bare negative would pass even if this redirected away.
    assert_selector ".snippets__item", count: owner.snippets.count
  end

  # Observed rather than clicked through. This page compiles ruby.wasm on load,
  # and while it does the renderer drops synthesised clicks and keystrokes
  # outright -- the click never even reaches the DOM, so driving Save from here
  # is a coin toss no amount of waiting fixes. What only a browser can show is
  # that the JS copies the editor into the form's hidden field; that posting
  # that field creates the snippet is SnippetsControllerTest's job.
  test "the playground's save form carries the code the editor is showing" do
    sign_in_as(users(:one))

    visit root_path

    assert_selector "#snippet-code-field[value*='RbConfig']", visible: :all
  end

  test "the playground's save form posts to the snippet collection" do
    sign_in_as(users(:one))

    visit root_path

    assert_selector "form.save-form[action='#{snippets_path}'][method='post']"
  end

  test "a signed-out visitor can read a saved snippet" do
    snippet = snippets(:one_hello)

    visit snippet_path(snippet)

    assert_selector "#snippet-code", text: snippet.code
  end

  test "a signed-out visitor is offered the playground link and no manage actions" do
    visit snippet_path(snippets(:one_hello))

    assert_selector ".snippet__actions a, .snippet__actions button", count: 1
  end

  test "a signed-out visitor is redirected to sign in when browsing the snippet list" do
    visit snippets_path

    assert_selector "input[type=submit][value='Sign in']"
  end

  test "opening a snippet in the playground hands its code over through the shared c param" do
    snippet = snippets(:one_fizzbuzz)
    visit snippet_path(snippet)

    click_on "Open in playground"

    assert_field "code", with: snippet.code
  end

  test "opening a snippet in the playground lands on the playground's own URL, not the snippet's" do
    visit snippet_path(snippets(:one_fizzbuzz))

    click_on "Open in playground"

    assert_current_path(/\A\/\?c=/, url: false)
  end

  test "the playground invites a signed-out visitor to sign in instead of offering Save" do
    visit root_path

    assert_selector ".playground__save", text: "Sign in to save this code as a snippet."
  end

  private

  # Signs in by minting the session cookie rather than driving the form. The
  # form itself is covered by SessionsControllerTest, and every extra
  # synthesised click in this suite is another chance for a renderer still busy
  # compiling ruby.wasm -- from any earlier test's playground visit -- to drop
  # it on the floor.
  def sign_in_as(user)
    session = user.sessions.create!
    jar = ActionDispatch::TestRequest.create.cookie_jar
    jar.signed[:session_id] = session.id

    # Selenium only accepts a cookie once the browser is on that domain, and
    # the sign-in page is the cheapest one to be on (no wasm).
    visit new_session_path
    page.driver.browser.manage.add_cookie(
      name: "session_id", value: CGI.escape(jar[:session_id])
    )
  end
end
