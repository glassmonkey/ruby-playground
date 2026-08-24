class Snippet < ApplicationRecord
  # Exposed so the forms can cap input at the same length the model enforces,
  # instead of the two drifting apart.
  TITLE_MAX_LENGTH = 100
  CODE_MAX_LENGTH = 100_000

  belongs_to :user

  validates :title, presence: true, length: { maximum: TITLE_MAX_LENGTH }
  validates :code, presence: true, length: { maximum: CODE_MAX_LENGTH }
end
