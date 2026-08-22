require "test_helper"

class PlaygroundControllerTest < ActionDispatch::IntegrationTest
  test "index is accessible without authentication" do
    get root_url

    assert_response :success
  end
end
