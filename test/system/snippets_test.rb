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
    sign_in_through_the_form(owner)
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
    sign_in_through_the_form(owner)

    visit snippets_path

    # A count rather than assert_no_link: the list is empty on the sign-in page
    # too, so a bare negative would pass even if this redirected away.
    assert_selector ".snippets__item", count: owner.snippets.count
  end

  test "saving from the playground captures whatever is in the editor" do
    sign_in_through_the_form(users(:one))

    visit root_path
    fill_in "Save as", with: "Captured from the playground"
    click_on "Save"

    assert_selector "#snippet-code", text: "RUBY_VERSION"
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

  def sign_in_through_the_form(user)
    visit new_session_path
    fill_in "Enter your email address", with: user.email_address
    fill_in "Enter your password", with: "password"
    click_button "Sign in"
    # click_button returns before the redirect lands, so without waiting on the
    # signed-in nav the next visit can outrun the session cookie being set.
    assert_link "My snippets"
  end
end
