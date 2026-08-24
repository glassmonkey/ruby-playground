require "application_system_test_case"

class AuthenticationTest < ApplicationSystemTestCase
  test "logging in and then logging out via the header button returns to the sign-in page" do
    user = users(:one)

    visit new_session_path
    fill_in "email_address", with: user.email_address
    fill_in "password", with: "password"
    click_button "Sign in"

    assert_selector "button", text: "Logout"

    click_button "Logout"

    assert_current_path new_session_path
    assert_no_selector "button", text: "Logout"
  end

  test "visiting the playground page while signed out does not show a logout button" do
    visit root_path

    assert_no_selector "button", text: "Logout"
  end
end
