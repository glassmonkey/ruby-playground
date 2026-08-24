require "test_helper"

class SnippetsControllerTest < ActionDispatch::IntegrationTest
  # ADR-0012: anyone holding a snippet's URL can read it.

  test "show renders the code for a signed-out visitor" do
    snippet = snippets(:one_hello)

    get snippet_path(snippet)

    assert_select "#snippet-code", text: snippet.code
  end

  # Asserting the *complete* action list rather than the absence of one link:
  # a page that never rendered has no Edit link either, so "count: 0" alone
  # would still pass if show started redirecting.

  test "show offers a signed-out visitor the playground link and nothing else" do
    get snippet_path(snippets(:one_hello))

    assert_equal([ "Open in playground" ], snippet_action_labels)
  end

  test "show offers a signed-in stranger the playground link and nothing else" do
    sign_in_as(users(:two))

    get snippet_path(snippets(:one_hello))

    assert_equal([ "Open in playground" ], snippet_action_labels)
  end

  test "show offers the owner the manage actions too" do
    sign_in_as(users(:one))

    get snippet_path(snippets(:one_hello))

    assert_equal([ "Open in playground", "Edit", "Delete" ], snippet_action_labels)
  end

  # Everything that reads a collection or changes a record needs the owner.

  test "index redirects a signed-out visitor to sign in" do
    get snippets_path

    assert_redirected_to new_session_path
  end

  test "index lists exactly the signed-in owner's snippets, most recent first" do
    owner = users(:one)
    sign_in_as(owner)

    get snippets_path

    assert_equal(
      owner.snippets.order(updated_at: :desc).pluck(:title),
      css_select(".snippets__item a").map { |link| link.text }
    )
  end

  test "new redirects a signed-out visitor to sign in" do
    get new_snippet_path

    assert_redirected_to new_session_path
  end

  test "create redirects a signed-out visitor to sign in" do
    post snippets_path, params: { snippet: { title: "Sneaky", code: "puts 1" } }

    assert_redirected_to new_session_path
  end

  test "create stores nothing for a signed-out visitor" do
    assert_no_difference("Snippet.count") do
      post snippets_path, params: { snippet: { title: "Sneaky", code: "puts 1" } }
    end
  end

  test "create stores the snippet against the signed-in owner" do
    owner = users(:one)
    sign_in_as(owner)

    post snippets_path, params: { snippet: { title: "Saved from playground", code: "puts 41 + 1" } }

    assert_equal(
      [ owner, "Saved from playground", "puts 41 + 1" ],
      Snippet.last.then { |s| [ s.user, s.title, s.code ] }
    )
  end

  test "create redirects to the saved snippet" do
    sign_in_as(users(:one))

    post snippets_path, params: { snippet: { title: "Saved from playground", code: "puts 41 + 1" } }

    assert_redirected_to snippet_path(Snippet.last)
  end

  test "create re-renders the form when the snippet is invalid" do
    sign_in_as(users(:one))

    post snippets_path, params: { snippet: { title: "", code: "puts 1" } }

    assert_response :unprocessable_entity
  end

  test "create stores nothing when the snippet is invalid" do
    sign_in_as(users(:one))

    assert_no_difference("Snippet.count") do
      post snippets_path, params: { snippet: { title: "", code: "puts 1" } }
    end
  end

  test "edit is not found for someone else's snippet" do
    sign_in_as(users(:two))

    get edit_snippet_path(snippets(:one_hello))

    assert_response :not_found
  end

  test "update rewrites the owner's own snippet" do
    snippet = snippets(:one_hello)
    sign_in_as(users(:one))

    patch snippet_path(snippet), params: { snippet: { title: "Renamed", code: "puts 'new body'" } }

    assert_equal(
      [ "Renamed", "puts 'new body'" ],
      snippet.reload.then { |s| [ s.title, s.code ] }
    )
  end

  test "update is not found for someone else's snippet" do
    sign_in_as(users(:two))

    patch snippet_path(snippets(:one_hello)), params: { snippet: { title: "Hijacked", code: "puts 1" } }

    assert_response :not_found
  end

  test "update leaves someone else's snippet untouched" do
    snippet = snippets(:one_hello)
    sign_in_as(users(:two))

    patch snippet_path(snippet), params: { snippet: { title: "Hijacked", code: "puts 1" } }

    assert_equal(
      [ "Hello from one", "puts 'hello from one'" ],
      snippet.reload.then { |s| [ s.title, s.code ] }
    )
  end

  test "update re-renders the form when the change is invalid" do
    sign_in_as(users(:one))

    patch snippet_path(snippets(:one_hello)), params: { snippet: { title: "", code: "puts 1" } }

    assert_response :unprocessable_entity
  end

  test "destroy removes the owner's own snippet" do
    snippet = snippets(:one_hello)
    sign_in_as(users(:one))

    delete snippet_path(snippet)

    assert_nil(Snippet.find_by(id: snippet.id))
  end

  test "destroy redirects back to the snippet list" do
    sign_in_as(users(:one))

    delete snippet_path(snippets(:one_hello))

    assert_redirected_to snippets_path
  end

  test "destroy is not found for someone else's snippet" do
    sign_in_as(users(:two))

    delete snippet_path(snippets(:one_hello))

    assert_response :not_found
  end

  test "destroy leaves someone else's snippet in place" do
    snippet = snippets(:one_hello)
    sign_in_as(users(:two))

    delete snippet_path(snippet)

    assert_equal(snippet, Snippet.find_by(id: snippet.id))
  end

  private
    def snippet_action_labels
      css_select(".snippet__actions a, .snippet__actions button").map { |element| element.text.strip }
    end
end
