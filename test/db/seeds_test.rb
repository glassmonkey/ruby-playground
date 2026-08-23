require "test_helper"

class SeedsTest < ActiveSupport::TestCase
  test "creates an owner user from OWNER_EMAIL and OWNER_PASSWORD" do
    ENV["OWNER_EMAIL"] = "owner@example.com"
    ENV["OWNER_PASSWORD"] = "supersecretpassword"

    assert_difference("User.count", 1) do
      Rails.application.load_seed
    end

    user = User.find_by(email_address: "owner@example.com")
    assert user.authenticate("supersecretpassword")
  ensure
    ENV.delete("OWNER_EMAIL")
    ENV.delete("OWNER_PASSWORD")
  end

  test "creates no user when OWNER_EMAIL and OWNER_PASSWORD are absent" do
    ENV.delete("OWNER_EMAIL")
    ENV.delete("OWNER_PASSWORD")

    assert_no_difference("User.count") do
      Rails.application.load_seed
    end
  end

  test "creates no user when only OWNER_PASSWORD is present" do
    ENV.delete("OWNER_EMAIL")
    ENV["OWNER_PASSWORD"] = "supersecretpassword"

    assert_no_difference("User.count") do
      Rails.application.load_seed
    end
  ensure
    ENV.delete("OWNER_PASSWORD")
  end

  test "is idempotent when run more than once" do
    ENV["OWNER_EMAIL"] = "owner@example.com"
    ENV["OWNER_PASSWORD"] = "supersecretpassword"

    Rails.application.load_seed

    assert_no_difference("User.count") do
      Rails.application.load_seed
    end
  ensure
    ENV.delete("OWNER_EMAIL")
    ENV.delete("OWNER_PASSWORD")
  end
end
