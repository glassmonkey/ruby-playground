require "test_helper"

class SnippetTest < ActiveSupport::TestCase
  test "reports exactly which attributes fail validation" do
    owner = users(:one)
    cases = {
      "minimal valid snippet" => { user: owner, title: "t", code: "1", want: [] },
      "valid at both maximum lengths" => {
        user: owner,
        title: "t" * Snippet::TITLE_MAX_LENGTH,
        code: "1" * Snippet::CODE_MAX_LENGTH,
        want: []
      },
      "blank title" => { user: owner, title: "", code: "1", want: [ :title ] },
      "blank code" => { user: owner, title: "t", code: "", want: [ :code ] },
      "title one character over the maximum" => {
        user: owner,
        title: "t" * (Snippet::TITLE_MAX_LENGTH + 1),
        code: "1",
        want: [ :title ]
      },
      "code one character over the maximum" => {
        user: owner,
        title: "t",
        code: "1" * (Snippet::CODE_MAX_LENGTH + 1),
        want: [ :code ]
      },
      "blank title and blank code" => { user: owner, title: "", code: "", want: [ :title, :code ] },
      "no owner" => { user: nil, title: "t", code: "1", want: [ :user ] }
    }

    cases.each do |name, kase|
      # Arrange
      sut = Snippet.new(user: kase[:user], title: kase[:title], code: kase[:code])

      # Act
      sut.validate
      got = sut.errors.attribute_names

      # Assert
      assert_equal(kase[:want], got, name)
    end
  end

  test "keeps code byte-for-byte, including whitespace and multibyte characters" do
    # Arrange
    code = "def greet\n  puts 'こんにちは'\nend\n"
    sut = users(:one).snippets.new(title: "Greeter", code: code)

    # Act
    sut.save!
    got = sut.reload.code

    # Assert
    assert_equal(code, got)
  end

  test "destroys the owner's snippets when the owner is destroyed" do
    # Arrange
    owner = User.create!(email_address: "snippet-owner@example.com", password: "password123")
    snippet = owner.snippets.create!(title: "t", code: "1")

    # Act
    owner.destroy!

    # Assert
    assert_not Snippet.exists?(snippet.id)
  end
end
